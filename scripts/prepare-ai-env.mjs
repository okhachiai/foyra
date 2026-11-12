// stdin/stdout only: deployment redirects both to private files, never to logs.
import { randomBytes } from 'node:crypto';
let text = '';
for await (const chunk of process.stdin) text += chunk;
try {
  for (const name of ['LLM_KEY_SECRET', 'CRON_TOKEN']) {
    const pattern = new RegExp(`^[ \t]*(?:export[ \t]+)?${name}[ \t]*([=:])[ \t]*(.*)$`, 'gm');
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 1) throw new Error(`Duplicate ${name} entries: resolve them before deploying.`);
    if (matches[0]?.[1] === ":") throw new Error(`Use an equals sign for ${name} before deploying.`);
    let value = matches[0]?.[2]?.trim() ?? '';
    if (value.startsWith('"') || value.startsWith("'")) {
      const end = value.indexOf(value[0], 1);
      if (end < 0 || (value.slice(end + 1).trim() && !value.slice(end + 1).trim().startsWith('#'))) throw new Error(`Invalid ${name} entry: check its quoting.`);
      value = value.slice(1, end);
    } else value = value.split('#')[0].trim();
    if (value.includes('${')) throw new Error(`Set ${name} directly instead of using interpolation.`);
    if (name === 'CRON_TOKEN' && value && !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('CRON_TOKEN must contain only letters, digits, underscores or hyphens.');
    if (value) continue; // Never rotate an existing encryption key or token.
    const line = `${name}=${randomBytes(32).toString('hex')}`;
    text = matches.length ? text.replace(pattern, line) : text.replace(/\n?$/, '\n') + line + '\n';
  }
  process.stdout.write(text);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
