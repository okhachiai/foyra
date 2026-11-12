import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
const script = new URL("../../scripts/prepare-ai-env.mjs", import.meta.url).pathname;
const prepare = (input: string) => execFileSync(process.execPath, [script], { input, encoding: "utf8" });
describe("AI secret initialization", () => {
  it("creates distinct random secrets only for missing or empty entries", () => {
    const output = prepare('POSTGRES_PASSWORD=preserve-me\nLLM_KEY_SECRET="" # empty\nCRON_TOKEN=\n');
    expect(output).toContain("POSTGRES_PASSWORD=preserve-me");
    const key = output.match(/^LLM_KEY_SECRET=([a-f0-9]{64})$/m)?.[1];
    const token = output.match(/^CRON_TOKEN=([a-f0-9]{64})$/m)?.[1];
    expect(key).toHaveLength(64);
    expect(token).toHaveLength(64);
    expect(key).not.toBe(token);
    expect(prepare(output)).toBe(output);
  });
  it("preserves existing keys and unrelated settings byte for byte", () => {
    const text = "  LLM_KEY_SECRET='keep-this-key'\n\texport CRON_TOKEN=keep-this-token\nAPP_URL=https://example.test\n";
    expect(prepare(text)).toBe(text);
  });
  it("refuses ambiguous secrets without printing their values", () => {
    for (const text of ["LLM_KEY_SECRET=do-not-print-this\nLLM_KEY_SECRET=\n", "LLM_KEY_SECRET=${OTHER_SECRET}\n", "CRON_TOKEN='unsafe quote token'\n"]) {
      const result = spawnSync(process.execPath, [script], { input: text, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("do-not-print-this");
    }
  });
});
