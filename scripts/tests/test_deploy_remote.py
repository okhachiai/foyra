"""Deployment control-flow checks, with SSH and Docker replaced by local fakes.

Run with: python3 -m unittest discover -s scripts/tests
No server connection, Docker daemon or production secrets are used.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
DIGEST = 'ghcr.io/okhachiai/foyra@sha256:' + 'a' * 64


class DeployRemoteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.local = self.base / 'local'
        (self.local / 'scripts').mkdir(parents=True)
        shutil.copy(ROOT / 'scripts/deploy-remote.sh', self.local / 'scripts')
        shutil.copy(ROOT / 'compose.remote.yml', self.local)
        self.remote = self.base / "server's directory with spaces"
        self.remote.mkdir()
        (self.remote / '.env').write_text('POSTGRES_PASSWORD=unused\n')
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.env = dict(os.environ, PATH=f'{self.bin}:/usr/bin:/bin',
                        REMOTE_HOST='test-server', REMOTE_DIR=str(self.remote),
                        REMOTE_PROJECT='foyra', INIT='0', DEPLOY_IMAGE='ghcr.io/okhachiai/foyra:latest',
                        TEST_LOG=str(self.base / 'commands.jsonl'), TEST_DIGEST=DIGEST)
        self.program('ssh', '''
import subprocess
# Run the supplied remote command locally; remove only the server-specific PATH.
payload = sys.stdin.read()
if sys.argv[-1].startswith('bash -s -- '):
    payload = '\\n'.join(line for line in payload.splitlines() if not line.startswith('export PATH='))
sys.exit(subprocess.run(['bash', '-c', sys.argv[-1]], input=payload, text=True).returncode)
''')
        self.program('docker', '''
args = sys.argv[1:]
with open(os.environ['TEST_LOG'], 'a') as log:
    log.write(json.dumps({'args': args, 'volume': os.getenv('FOYRA_DB_VOLUME'),
                          'image': os.getenv('FOYRA_DEPLOY_IMAGE')}) + '\\n')
case = os.getenv('TEST_CASE', '')
if args[0] == 'run' and 'scripts/prepare-ai-env.mjs' in args:
    sys.stdout.write(sys.stdin.read())
elif args[:2] == ['ps', '-a']:
    print(os.environ['REMOTE_DIR'] + '/releases/old')
elif args[:2] == ['ps', '-q']:
    if case not in ('missing', 'stopped', 'orphan', 'new'):
        print('database-id')
elif args[:2] == ['ps', '-aq']:
    if case == 'stopped': print('database-id')
elif args[0] == 'inspect':
    print('bind:' if case == 'bind' else 'volume:custom-production-volume')
elif args[:2] == ['volume', 'inspect']:
    sys.exit(0 if case == 'orphan' else 1)
elif args[:2] == ['image', 'inspect']:
    print(os.environ['TEST_DIGEST'])
elif 'pull' in args and case == 'pull':
    sys.exit(1)
elif 'exec' in args and 'pg_dump' in args[-1]:
    if case == 'backup': sys.exit(1)
    print('fake-dump')
elif 'pg_restore' in args and case == 'verify':
    sys.exit(1)
''')

    def program(self, name, body):
        path = self.bin / name
        path.write_text(f'#!{sys.executable}\nimport json, os, sys\n' + body)
        path.chmod(0o755)

    def run_deploy(self, case='', init='0'):
        env = dict(self.env, TEST_CASE=case, INIT=init)
        result = subprocess.run(['bash', str(self.local / 'scripts/deploy-remote.sh')],
                                env=env, capture_output=True, text=True, timeout=10)
        log = Path(self.env['TEST_LOG'])
        commands = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        self.assertFalse((self.remote / '.deploy-lock').exists())
        return result, commands

    def test_existing_database_kept_and_backup_before_update(self):
        result, commands = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        up = next(i for i, item in enumerate(commands) if 'up' in item['args'])
        verify = next(i for i, item in enumerate(commands) if 'pg_restore' in item['args'])
        self.assertLess(verify, up)
        self.assertEqual(commands[up]['args'][-6:], ['up', '-d', '--no-deps', 'app', 'worker', 'cron'])
        self.assertEqual(commands[up]['volume'], 'custom-production-volume')
        self.assertEqual(commands[up]['image'], DIGEST)
        self.assertEqual(len(list((self.remote / 'backups').iterdir())), 1)
        release = next((self.remote / 'releases').iterdir())
        self.assertEqual(sorted(p.name for p in release.iterdir()), ['docker-compose.yml', 'image.txt'])
        self.assertEqual((release / 'image.txt').read_text().strip(), DIGEST)
        self.assertFalse(any('build' in c['args'] or 'down' in c['args'] for c in commands))

    def test_failures_never_replace_application(self):
        for case in ('pull', 'backup', 'verify', 'missing', 'bind'):
            with self.subTest(case=case):
                Path(self.env['TEST_LOG']).unlink(missing_ok=True)
                result, commands = self.run_deploy(case)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any('up' in c['args'] for c in commands))

    def test_init_refuses_stopped_database_and_existing_orphan_volume(self):
        for case in ('stopped', 'orphan'):
            with self.subTest(case=case):
                Path(self.env['TEST_LOG']).unlink(missing_ok=True)
                result, commands = self.run_deploy(case, init='1')
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any('up' in c['args'] for c in commands))

    def test_init_with_running_database_still_backs_up(self):
        result, commands = self.run_deploy(init='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any('pg_restore' in c['args'] for c in commands))
        self.assertTrue(any('--no-deps' in c['args'] for c in commands))

    def test_new_install_starts_database_dependency(self):
        result, commands = self.run_deploy('new', init='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        up = next(c for c in commands if 'up' in c['args'])
        self.assertEqual(up['args'][-5:], ['up', '-d', 'app', 'worker', 'cron'])
        self.assertEqual(up['volume'], 'foyra_pgdata')


if __name__ == '__main__':
    unittest.main()
