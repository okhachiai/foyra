import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { complete, configuredProviders, LlmError, pickProvider, testConnection, type LlmConfig } from "./llm";

const schema = { type: "object", properties: { a: { type: "string" } } };
const msgs = { system: "sys", user: "usr" };
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const NONE: LlmConfig = { llmProvider: null, claudeApiKey: null, claudeModel: null, localLlmUrl: null, localLlmModel: null, localLlmApiKey: null };
const cfg = (c: Partial<LlmConfig>): LlmConfig => ({ ...NONE, ...c });
const CLAUDE = cfg({ claudeApiKey: "k" });
const LOCAL = cfg({ localLlmUrl: "http://llm", localLlmModel: "m" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fournisseurs configurés", () => {
  it("aucun, Claude, puis les deux ; l'URL seule ne suffit pas", () => {
    expect(configuredProviders(NONE)).toEqual([]);
    expect(configuredProviders(CLAUDE)).toEqual(["CLAUDE"]);
    expect(configuredProviders({ ...CLAUDE, localLlmUrl: "http://x" })).toEqual(["CLAUDE"]);
    expect(configuredProviders({ ...LOCAL, claudeApiKey: "k" })).toEqual(["CLAUDE", "LOCAL"]);
  });

  it("pickProvider replie sur Claude, sinon null", () => {
    expect(pickProvider(cfg({ llmProvider: "LOCAL" }))).toBeNull();
    expect(pickProvider({ ...CLAUDE, llmProvider: "LOCAL" })).toBe("CLAUDE");
    expect(pickProvider(CLAUDE)).toBe("CLAUDE");
  });

  it("pickProvider : seul le local configuré, sans préférence ⇒ LOCAL", () => {
    expect(pickProvider(LOCAL)).toBe("LOCAL");
    expect(pickProvider({ ...LOCAL, llmProvider: "CLAUDE" })).toBe("LOCAL");
    expect(pickProvider({ ...LOCAL, claudeApiKey: "k", llmProvider: "LOCAL" })).toBe("LOCAL");
  });
});

describe("complete", () => {
  it("Claude : outil rapport forcé, renvoie l'entrée du tool_use", async () => {
    const f = vi.fn().mockResolvedValue(ok({ content: [{ type: "text", text: "x" }, { type: "tool_use", input: { a: "b" } }] }));
    vi.stubGlobal("fetch", f);
    const r = await complete("CLAUDE", CLAUDE, msgs, schema);
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
    const f = vi.fn().mockResolvedValue(ok({ content: [{ type: "tool_use", input: {} }] }));
    vi.stubGlobal("fetch", f);
    const r = await complete("CLAUDE", { ...CLAUDE, claudeModel: "autre" }, { ...msgs, retry: { previous: "{}", error: "bad" } }, schema);
    expect(r.model).toBe("autre");
    expect(JSON.parse(f.mock.calls[0][1].body).messages).toEqual([
      { role: "user", content: "usr" },
      { role: "assistant", content: "{}" },
      { role: "user", content: "Réponse refusée : bad. Corrige et renvoie le JSON complet." },
    ]);
  });

  it("local : URL sans slash final, json_schema, Bearer seulement avec clé", async () => {
    const local = cfg({ localLlmUrl: "http://llm:8080/", localLlmModel: "m" });
    const f = vi.fn().mockResolvedValue(ok({ choices: [{ message: { content: "{}" } }] }));
    vi.stubGlobal("fetch", f);
    expect(await complete("LOCAL", local, msgs, schema)).toEqual({ model: "m", text: "{}" });
    let [url, init] = f.mock.calls[0];
    expect(url).toBe("http://llm:8080/v1/chat/completions");
    expect(init.headers.Authorization).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "rapport", schema } });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("sys");
    expect(body.messages[0].content).toContain('"properties"');
    expect(body.messages[1]).toEqual({ role: "user", content: "usr" });

    await complete("LOCAL", { ...local, localLlmApiKey: "sk" }, { ...msgs, retry: { previous: "p", error: "e" } }, schema);
    [, init] = f.mock.calls[1];
    expect(init.headers.Authorization).toBe("Bearer sk");
    expect(JSON.parse(init.body).messages.slice(2)).toEqual([
      { role: "assistant", content: "p" },
      { role: "user", content: "Réponse refusée : e. Corrige et renvoie le JSON complet." },
    ]);
  });

  it("HTTP non 2xx et réseau en LlmError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }));
    await expect(complete("CLAUDE", CLAUDE, msgs, schema)).rejects.toThrow(new LlmError("Fournisseur LLM : trop de requêtes ou quota atteint (429), réessayer plus tard"));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(complete("CLAUDE", CLAUDE, msgs, schema)).rejects.toThrow("Fournisseur LLM injoignable");
    await expect(complete("CLAUDE", CLAUDE, msgs, schema)).rejects.toBeInstanceOf(LlmError);
  });

  it("erreurs explicites : statut, détail du fournisseur, cause réseau, délai", async () => {
    const http = (status: number, body: unknown) => vi.fn().mockResolvedValue({ ok: false, status, json: async () => body });
    vi.stubGlobal("fetch", http(401, { error: { message: "invalid x-api-key" } }));
    await expect(complete("CLAUDE", CLAUDE, msgs, schema)).rejects.toThrow("Fournisseur LLM : clé API invalide ou absente (401) — invalid x-api-key");
    vi.stubGlobal("fetch", http(404, { error: "model 'm' not found" }));
    await expect(complete("LOCAL", LOCAL, msgs, schema)).rejects.toThrow("introuvable (404) : vérifier le nom du modèle et l'URL (sans /v1) — model 'm' not found");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })));
    await expect(complete("LOCAL", LOCAL, msgs, schema)).rejects.toThrow("connexion refusée sur llm");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" })));
    await expect(complete("LOCAL", LOCAL, msgs, schema)).rejects.toThrow("délai dépassé");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError("x"); } }));
    await expect(complete("LOCAL", LOCAL, msgs, schema)).rejects.toThrow("réponse illisible");
  });

  it("testConnection : requête d'1 token, renvoie le modèle", async () => {
    const f = vi.fn().mockResolvedValue(ok({}));
    vi.stubGlobal("fetch", f);
    expect(await testConnection("CLAUDE", CLAUDE)).toBe("claude-sonnet-5-5");
    expect(JSON.parse(f.mock.calls[0][1].body).max_tokens).toBe(1);
    expect(await testConnection("LOCAL", LOCAL)).toBe("m");
    expect(f.mock.calls[1][0]).toBe("http://llm/v1/chat/completions");
  });

  it("réponse tronquée : LlmError pour les deux fournisseurs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ stop_reason: "max_tokens", content: [{ type: "tool_use", input: {} }] })));
    await expect(complete("CLAUDE", CLAUDE, msgs, schema)).rejects.toThrow(new LlmError("Fournisseur LLM : réponse tronquée."));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).max_tokens).toBe(16000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ choices: [{ finish_reason: "length", message: { content: "{" } }] })));
    await expect(complete("LOCAL", LOCAL, msgs, schema)).rejects.toThrow(new LlmError("Fournisseur LLM : réponse tronquée."));
  });

  it("200 sans content tableau ni choices : réponse vide, jamais TypeError", async () => {
    for (const body of [{ content: "texte" }, { content: { type: "tool_use" } }, {}, null]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(body)));
      await expect(complete("CLAUDE", CLAUDE, msgs, schema)).rejects.toThrow(new LlmError("Fournisseur LLM : réponse vide"));
    }
    for (const body of [{}, { choices: "x" }, { choices: [] }, null]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(body)));
      await expect(complete("LOCAL", LOCAL, msgs, schema)).rejects.toThrow(new LlmError("Fournisseur LLM : réponse vide"));
    }
  });
});
