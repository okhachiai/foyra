import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Household, LlmProvider } from "@prisma/client";

/** Erreur de fournisseur LLM (HTTP, réseau, réponse inutilisable) ; message affichable. */
export class LlmError extends Error {}

// --- Clés API chiffrées en base (AES-256-GCM, clé dérivée de LLM_KEY_SECRET) ---
// ponytail: sans LLM_KEY_SECRET, les clés restent en clair (comportement historique) ; anciennes clés en clair relues telles quelles.
const SEALED = "enc:v1:";
const keySecret = () => (process.env.LLM_KEY_SECRET ? createHash("sha256").update(process.env.LLM_KEY_SECRET).digest() : null);

/** Valeur à enregistrer : chiffrée si LLM_KEY_SECRET est défini (une valeur déjà chiffrée est gardée telle quelle). */
export function sealSecret(value: string) {
  const key = keySecret();
  if (!key || value.startsWith(SEALED)) return value;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return SEALED + Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}

/** Valeur enregistrée → clé en clair ; LlmError si LLM_KEY_SECRET manque ou a changé. */
export function openSecret(value: string | null) {
  if (!value?.startsWith(SEALED)) return value;
  const key = keySecret();
  const raw = Buffer.from(value.slice(SEALED.length), "base64");
  try {
    if (!key) throw new Error();
    const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12), { authTagLength: 16 });
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    throw new LlmError("Unreadable API key: LLM_KEY_SECRET missing or changed. Enter the key again in Settings → AI.");
  }
}

const EMPTY = "LLM provider: empty response", TRUNCATED = "LLM provider: truncated response.";

type Messages = { system: string; user: string; retry?: { previous: string; error: string } };

export const PROVIDER_LABELS: Record<LlmProvider, string> = { CLAUDE: "Claude (Anthropic)", LOCAL: "Local model" };

/** Réglages LLM du foyer, saisis dans Paramètres. */
export type LlmConfig = Pick<Household, "llmProvider" | "claudeApiKey" | "claudeModel" | "localLlmUrl" | "localLlmModel" | "localLlmApiKey">;

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";

/** Fournisseurs dont les réglages sont renseignés. */
export function configuredProviders(c: LlmConfig): LlmProvider[] {
  const p: LlmProvider[] = [];
  if (c.claudeApiKey) p.push("CLAUDE");
  if (c.localLlmUrl && c.localLlmModel) p.push("LOCAL");
  return p;
}

/** Préférence du foyer si configurée, sinon le premier configuré (Claude puis local), sinon rien. */
export function pickProvider(c: LlmConfig): LlmProvider | null {
  const ok = configuredProviders(c);
  return c.llmProvider && ok.includes(c.llmProvider) ? c.llmProvider : (ok[0] ?? null);
}

/** Tours de conversation : la demande, puis (nouvel essai) la réponse refusée et la correction demandée. */
function turns({ user, retry }: Messages) {
  const m = [{ role: "user", content: user }];
  if (retry) {
    m.push({ role: "assistant", content: retry.previous });
    m.push({ role: "user", content: `Response rejected: ${retry.error}. Fix it and send the complete JSON again.` });
  }
  return m;
}

/** Message lisible pour un statut HTTP du fournisseur, complété du détail renvoyé s'il existe. */
function httpError(status: number, detail: string) {
  const why =
    status === 401 ? "invalid or missing API key (401)" :
    status === 403 ? "access denied: key has no access to this model or the account is restricted (403)" :
    status === 404 ? "not found (404): check the model name and the URL (without /v1)" :
    status === 400 ? "request rejected (400): model or parameters not accepted" :
    status === 402 || status === 529 ? `credit exhausted or service overloaded (${status})` :
    status === 429 ? "too many requests or quota reached (429), try again later" :
    status >= 500 ? `provider server error (${status}), try again later` :
    `error ${status}`;
  return new LlmError(`LLM provider: ${why}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
}

/** Cause d'un échec réseau (fetch lève TypeError, la cause porte le code système). */
function networkError(e: unknown, url: string) {
  const err = e as { name?: string; cause?: { code?: string } };
  if (err?.name === "TimeoutError") return new LlmError("LLM provider: timed out, the server is not responding.");
  const host = URL.canParse(url) ? new URL(url).host : url;
  const code = err?.cause?.code;
  if (code === "ECONNREFUSED") return new LlmError(`LLM provider unreachable: connection refused on ${host} (server stopped or wrong port?)`);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new LlmError(`LLM provider unreachable: unknown address ${host} (check the URL).`);
  if (code?.startsWith("ERR_TLS") || code?.includes("CERT")) return new LlmError(`LLM provider unreachable: TLS certificate rejected for ${host}.`);
  return new LlmError(`LLM provider unreachable${code ? ` (${code})` : ""}: ${host}`);
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeout = 600_000) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      redirect: "error", // pas de rebond 30x vers une autre cible (SSRF)
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw networkError(e, url);
  }
  if (!res.ok) {
    // Anthropic et OpenAI : { error: { message } } ; Ollama : { error: "..." }.
    const data = await res.json().catch(() => null);
    const detail = typeof data?.error === "string" ? data.error : (data?.error?.message ?? "");
    throw httpError(res.status, String(detail));
  }
  try {
    return await res.json();
  } catch {
    throw new LlmError("LLM provider: unreadable response (not JSON). Does the URL point to an OpenAI-compatible API?");
  }
}

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const claudeHeaders = (c: LlmConfig) => ({ "x-api-key": openSecret(c.claudeApiKey) ?? "", "anthropic-version": "2023-06-01" });
/**
 * Anti-SSRF : l'URL du modèle local est saisie par un ADMIN du foyer, l'hôte (nom:port) doit figurer dans LLM_ALLOWED_HOSTS,
 * liste fixée par l'opérateur. Vide = modèle local désactivé.
 */
export function localHostAllowed(url: string) {
  const allowed = (process.env.LLM_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return URL.canParse(url) && allowed.includes(new URL(url).host);
}
const localUrl = (c: LlmConfig) => {
  const base = (c.localLlmUrl ?? "").replace(/\/+$/, "");
  if (!localHostAllowed(base)) throw new LlmError("Local model: host not allowed (LLM_ALLOWED_HOSTS).");
  return `${base}/v1/chat/completions`;
};
const localHeaders = (c: LlmConfig): Record<string, string> => (c.localLlmApiKey ? { Authorization: `Bearer ${openSecret(c.localLlmApiKey)}` } : {});

/** Petite requête réelle (1 token) pour vérifier clé, modèle et URL ; lève LlmError avec la cause. */
export async function testConnection(provider: LlmProvider, c: LlmConfig): Promise<string> {
  if (provider === "CLAUDE") {
    const model = c.claudeModel || DEFAULT_CLAUDE_MODEL;
    await post(CLAUDE_URL, claudeHeaders(c), { model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }, 15_000);
    return model;
  }
  const model = c.localLlmModel ?? "";
  await post(localUrl(c), localHeaders(c), { model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }, 30_000);
  return model;
}

/** Appelle le fournisseur et renvoie le texte JSON produit ; la validation du schéma reste à l'appelant. */
export async function complete(provider: LlmProvider, c: LlmConfig, messages: Messages, schema: object): Promise<{ model: string; text: string }> {
  if (provider === "CLAUDE") {
    const model = c.claudeModel || DEFAULT_CLAUDE_MODEL;
    const data = await post(
      CLAUDE_URL,
      claudeHeaders(c),
      {
        model,
        max_tokens: 16000,
        system: messages.system,
        messages: turns(messages),
        tools: [{ name: "rapport", description: "Budget report", input_schema: schema }],
        tool_choice: { type: "tool", name: "rapport" },
      },
    );
    if (data?.stop_reason === "max_tokens") throw new LlmError(TRUNCATED);
    const block = Array.isArray(data?.content) ? data.content.find((b: { type?: string }) => b?.type === "tool_use") : undefined;
    if (!block) throw new LlmError(EMPTY);
    return { model, text: JSON.stringify(block.input) };
  }
  const model = c.localLlmModel ?? "";
  const data = await post(
    localUrl(c),
    localHeaders(c),
    {
      model,
      // json_schema : accepté par OpenAI, LM Studio, Ollama, vLLM, llama.cpp (LM Studio refuse json_object).
      response_format: { type: "json_schema", json_schema: { name: "rapport", schema } },
      messages: [
        { role: "system", content: `${messages.system}\n\nReply only with a JSON object matching this schema:\n${JSON.stringify(schema)}` },
        ...turns(messages),
      ],
    },
  );
  const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
  if (choice?.finish_reason === "length") throw new LlmError(TRUNCATED);
  // Modèle « thinking » (LM Studio, vLLM) : content vide, JSON rangé dans reasoning_content.
  const text = choice?.message?.content || choice?.message?.reasoning_content;
  if (typeof text !== "string" || !text.trim()) throw new LlmError(EMPTY);
  return { model, text };
}
