import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { complete, configuredProviders, LlmError, pickProvider } from "./llm";

const schema = { type: "object", properties: { a: { type: "string" } } };
const msgs = { system: "sys", user: "usr" };
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  for (const k of ["ANTHROPIC_API_KEY", "CLAUDE_MODEL", "LOCAL_LLM_URL", "LOCAL_LLM_MODEL", "LOCAL_LLM_API_KEY"]) vi.stubEnv(k, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fournisseurs configurés", () => {
  it("aucun, Claude, puis les deux ; l'URL seule ne suffit pas", () => {
    expect(configuredProviders()).toEqual([]);
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    expect(configuredProviders()).toEqual(["CLAUDE"]);
    vi.stubEnv("LOCAL_LLM_URL", "http://x");
    expect(configuredProviders()).toEqual(["CLAUDE"]);
    vi.stubEnv("LOCAL_LLM_MODEL", "m");
    expect(configuredProviders()).toEqual(["CLAUDE", "LOCAL"]);
  });

  it("pickProvider replie sur Claude, sinon null", () => {
    expect(pickProvider("LOCAL")).toBeNull();
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    expect(pickProvider("LOCAL")).toBe("CLAUDE");
    expect(pickProvider(null)).toBe("CLAUDE");
  });

  it("pickProvider : seul le local configuré, sans préférence ⇒ LOCAL", () => {
    vi.stubEnv("LOCAL_LLM_URL", "http://llm");
    vi.stubEnv("LOCAL_LLM_MODEL", "m");
    expect(pickProvider(null)).toBe("LOCAL");
    expect(pickProvider("CLAUDE")).toBe("LOCAL");
  });
});

describe("complete", () => {
  it("Claude : outil rapport forcé, renvoie l'entrée du tool_use", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    const f = vi.fn().mockResolvedValue(ok({ content: [{ type: "text", text: "x" }, { type: "tool_use", input: { a: "b" } }] }));
    vi.stubGlobal("fetch", f);
    const r = await complete("CLAUDE", msgs, schema);
    expect(r).toEqual({ model: "claude-sonnet-5-5", text: '{"a":"b"}' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("k");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.system).toBe("sys");
    expect(body.tools[0]).toMatchObject({ name: "rapport", input_schema: schema });
    expect(body.tool_choice).toEqual({ type: "tool", name: "rapport" });
    expect(body.messages).toEqual([{ role: "user", content: "usr" }]);
  });

  it("Claude : retry ajoute la réponse refusée et la demande de correction", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("CLAUDE_MODEL", "autre");
    const f = vi.fn().mockResolvedValue(ok({ content: [{ type: "tool_use", input: {} }] }));
    vi.stubGlobal("fetch", f);
    const r = await complete("CLAUDE", { ...msgs, retry: { previous: "{}", error: "bad" } }, schema);
    expect(r.model).toBe("autre");
    expect(JSON.parse(f.mock.calls[0][1].body).messages).toEqual([
      { role: "user", content: "usr" },
      { role: "assistant", content: "{}" },
      { role: "user", content: "Réponse refusée : bad. Corrige et renvoie le JSON complet." },
    ]);
  });

  it("local : URL sans slash final, json_object, Bearer seulement avec clé", async () => {
    vi.stubEnv("LOCAL_LLM_URL", "http://llm:8080/");
    vi.stubEnv("LOCAL_LLM_MODEL", "m");
    const f = vi.fn().mockResolvedValue(ok({ choices: [{ message: { content: "{}" } }] }));
    vi.stubGlobal("fetch", f);
    expect(await complete("LOCAL", msgs, schema)).toEqual({ model: "m", text: "{}" });
    let [url, init] = f.mock.calls[0];
    expect(url).toBe("http://llm:8080/v1/chat/completions");
    expect(init.headers.Authorization).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("sys");
    expect(body.messages[0].content).toContain('"properties"');
    expect(body.messages[1]).toEqual({ role: "user", content: "usr" });

    vi.stubEnv("LOCAL_LLM_API_KEY", "sk");
    await complete("LOCAL", { ...msgs, retry: { previous: "p", error: "e" } }, schema);
    [, init] = f.mock.calls[1];
    expect(init.headers.Authorization).toBe("Bearer sk");
    expect(JSON.parse(init.body).messages.slice(2)).toEqual([
      { role: "assistant", content: "p" },
      { role: "user", content: "Réponse refusée : e. Corrige et renvoie le JSON complet." },
    ]);
  });

  it("HTTP non 2xx et réseau en LlmError", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(complete("CLAUDE", msgs, schema)).rejects.toThrow(new LlmError("Fournisseur LLM : erreur 429"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(complete("CLAUDE", msgs, schema)).rejects.toThrow("Fournisseur LLM injoignable");
    await expect(complete("CLAUDE", msgs, schema)).rejects.toBeInstanceOf(LlmError);
  });

  it("réponse tronquée : LlmError pour les deux fournisseurs", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ stop_reason: "max_tokens", content: [{ type: "tool_use", input: {} }] })));
    await expect(complete("CLAUDE", msgs, schema)).rejects.toThrow(new LlmError("Fournisseur LLM : réponse tronquée."));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).max_tokens).toBe(16000);
    vi.stubEnv("LOCAL_LLM_URL", "http://llm");
    vi.stubEnv("LOCAL_LLM_MODEL", "m");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ choices: [{ finish_reason: "length", message: { content: "{" } }] })));
    await expect(complete("LOCAL", msgs, schema)).rejects.toThrow(new LlmError("Fournisseur LLM : réponse tronquée."));
  });

  it("200 sans content tableau ni choices : réponse vide, jamais TypeError", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("LOCAL_LLM_URL", "http://llm");
    vi.stubEnv("LOCAL_LLM_MODEL", "m");
    for (const body of [{ content: "texte" }, { content: { type: "tool_use" } }, {}, null]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(body)));
      await expect(complete("CLAUDE", msgs, schema)).rejects.toThrow(new LlmError("Fournisseur LLM : réponse vide"));
    }
    for (const body of [{}, { choices: "x" }, { choices: [] }, null]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(body)));
      await expect(complete("LOCAL", msgs, schema)).rejects.toThrow(new LlmError("Fournisseur LLM : réponse vide"));
    }
  });
});
