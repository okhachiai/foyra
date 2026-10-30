import type { LlmProvider } from "@prisma/client";

/** Erreur de fournisseur LLM (HTTP, réseau, réponse inutilisable) ; message affichable. */
export class LlmError extends Error {}

type Messages = { system: string; user: string; retry?: { previous: string; error: string } };

export const PROVIDER_LABELS: Record<LlmProvider, string> = { CLAUDE: "Claude (Anthropic)", LOCAL: "Modèle local" };

/** Fournisseurs dont les variables d'environnement sont présentes. */
export function configuredProviders(): LlmProvider[] {
  const p: LlmProvider[] = [];
  if (process.env.ANTHROPIC_API_KEY) p.push("CLAUDE");
  if (process.env.LOCAL_LLM_URL && process.env.LOCAL_LLM_MODEL) p.push("LOCAL");
  return p;
}

/** Préférence du foyer si configurée, sinon le premier configuré (Claude puis local), sinon rien. */
export function pickProvider(pref: LlmProvider | null): LlmProvider | null {
  const ok = configuredProviders();
  return pref && ok.includes(pref) ? pref : (ok[0] ?? null);
}

/** Tours de conversation : la demande, puis (nouvel essai) la réponse refusée et la correction demandée. */
function turns({ user, retry }: Messages) {
  const m = [{ role: "user", content: user }];
  if (retry) {
    m.push({ role: "assistant", content: retry.previous });
    m.push({ role: "user", content: `Réponse refusée : ${retry.error}. Corrige et renvoie le JSON complet.` });
  }
  return m;
}

async function post(url: string, headers: Record<string, string>, body: unknown) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new LlmError(`Fournisseur LLM : erreur ${res.status}`);
    return await res.json();
  } catch (e) {
    throw e instanceof LlmError ? e : new LlmError("Fournisseur LLM injoignable");
  }
}

/** Appelle le fournisseur et renvoie le texte JSON produit ; la validation du schéma reste à l'appelant. */
export async function complete(provider: LlmProvider, messages: Messages, schema: object): Promise<{ model: string; text: string }> {
  if (provider === "CLAUDE") {
    const model = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
    const data = await post(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
      {
        model,
        max_tokens: 4096,
        system: messages.system,
        messages: turns(messages),
        tools: [{ name: "rapport", description: "Rapport mensuel du budget", input_schema: schema }],
        tool_choice: { type: "tool", name: "rapport" },
      },
    );
    const block = data?.content?.find((b: { type: string }) => b.type === "tool_use");
    if (!block) throw new LlmError("Fournisseur LLM : réponse vide");
    return { model, text: JSON.stringify(block.input) };
  }
  const model = process.env.LOCAL_LLM_MODEL ?? "";
  const key = process.env.LOCAL_LLM_API_KEY;
  const data = await post(
    `${(process.env.LOCAL_LLM_URL ?? "").replace(/\/+$/, "")}/v1/chat/completions`,
    key ? { Authorization: `Bearer ${key}` } : {},
    {
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${messages.system}\n\nRéponds uniquement par un objet JSON conforme à ce schéma :\n${JSON.stringify(schema)}` },
        ...turns(messages),
      ],
    },
  );
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new LlmError("Fournisseur LLM : réponse vide");
  return { model, text };
}
