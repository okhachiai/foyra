# Rapport LLM (phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rapport du mois proposé par un LLM (Claude ou local), à la demande ou chaque soir à 20:00, que l'app valide au centime et que l'utilisateur applique explicitement.

**Architecture:** L'app calcule toute l'entrée (`src/lib/report.ts`, réutilise `getSplit`/`visibleSplit`, `getBudget`/`envelopes`, `listMonthCharges`, soldes) ; `src/lib/llm.ts` appelle le fournisseur par `fetch` et renvoie du JSON ; `report.ts` valide la sortie, réessaie une fois avec l'erreur, stocke dans `Report`. Page `/rapports`, route `POST /api/reports/daily` appelée par un service docker `cron`.

**Tech Stack:** Next.js 15 App Router (Server Components + Server Actions dans `src/app/actions.ts`), Prisma 6.19 / Postgres 17, Vitest sur base réelle (`db-test`, port 5433), Tailwind 4. Aucune nouvelle dépendance.

**Spec:** `docs/superpowers/specs/2026-10-29-budget-comptes-partage-design.md` — section « Phase B — Rapport LLM » et « Droits et visibilité ». Phase A livrée sur `feat/partage-prorata` ; cette phase part de cette branche.

## Global Constraints

- Montants en centimes `Int` partout ; le LLM ne calcule aucun montant affiché comme « actuel ».
- Rien n'est écrit dans budget / opérations sans clic explicite (« Appliquer la répartition », « Appliquer les catégories »).
- Rien de ce qui part au LLM ne contient d'e-mail, de mot de passe, d'id de session ni de note privée hors libellé d'opération.
- Fournisseurs par `fetch`, aucune dépendance : Claude = `POST https://api.anthropic.com/v1/messages`, en-têtes `x-api-key`, `anthropic-version: 2023-06-01` ; env `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (défaut `claude-sonnet-5-5`). Local = `POST ${LOCAL_LLM_URL}/v1/chat/completions` (OpenAI-compatible), `response_format: { type: "json_object" }` ; env `LOCAL_LLM_URL`, `LOCAL_LLM_MODEL`, `LOCAL_LLM_API_KEY` facultatif (`Authorization: Bearer`).
- Fournisseur proposé seulement si ses variables sont présentes (Claude : `ANTHROPIC_API_KEY` ; local : `LOCAL_LLM_URL` et `LOCAL_LLM_MODEL`).
- Cron : `REPORT_CRON` (défaut `0 20 * * *`), `TZ=Europe/Paris`, `Authorization: Bearer $CRON_TOKEN`. `CRON_TOKEN` vide ⇒ la route refuse tout.
- Un seul rapport `DAILY` par foyer et par jour (index partiel SQL) ; relance sans doublon.
- Échec de validation → 1 nouvelle tentative avec l'erreur renvoyée au modèle, puis rapport stocké avec `error` et affiché comme tel.
- Textes UI et commentaires en français ; migrations SQL écrites à la main, additives.
- Copie exacte : bouton « Analyser » ; « Appliquer la répartition » ; « Appliquer les catégories » ; message budget validé « Repasser le budget en brouillon pour appliquer » ; mention Paramètres : « En mode Claude, montants, libellés, catégories et prénoms des membres sont envoyés à Anthropic. En mode local, rien ne sort du serveur. »

## Rulings (choix du planificateur, à relire)

1. **`plan[]` porte `budgetItemId`** — la spec exige « Σ plan d'une enveloppe ≤ son allocation » sans dire à quelle enveloppe appartient une ligne de plan.
2. **Lignes allouables** = enveloppes de `envelopes()` + réserve, **sans sous-lignes** : appliquer « prévu = réel + allocation » sur une ligne parent est impossible (son montant reste 0, total = enfants). Aucune ligne allouable ⇒ `allocations` doit être `[]`.
3. **Reste commun disponible** = Σ soldes des comptes communs non archivés − Σ charges `EXPENSE` non payées du mois sur ces comptes, **plancher 0**. Calculé en portée complète.
4. **`Report.userId`** (nullable) ajouté : `null` pour `DAILY` (visible admin seulement), auteur pour `MANUAL` (visible par lui et l'admin). Nécessaire pour la règle « chaque membre peut générer le sien ».
5. **`Household.llmProvider` nullable** : `null` ⇒ premier fournisseur configuré (Claude puis local). Aucun configuré ⇒ bouton « Analyser » masqué, message en Paramètres.
6. **Rapport sans budget du mois** : non généré, erreur « Aucun budget pour ce mois. » (pas de ligne `Report`).
7. **`/api/` exclu du middleware** : la route vérifie elle-même le jeton.

## Review Focus

1. LLM qui renvoie du texte autour du JSON, ou du JSON tronqué → erreur de validation lisible, une relance, puis rapport en erreur — jamais un 500.
2. Fournisseur injoignable / timeout (60 s) → rapport en erreur « Fournisseur LLM injoignable », pas de page blanche.
3. Membre non-admin : l'entrée envoyée ne contient ni revenu ni reste perso ni opérations des comptes qu'il ne lit pas.
4. Double déclenchement du cron le même jour → un seul rapport `DAILY`, deuxième appel 200 sans doublon.
5. « Appliquer » sur un rapport d'un mois passé ou dont les lignes ont été supprimées → ids absents ignorés, message ; budget validé → refus avec la copie exacte.

---

### Task 1: Schéma `Report` + fournisseurs LLM

**Files:**
- Modify: `prisma/schema.prisma` (Household, nouveau `Report`, enums)
- Create: `prisma/migrations/20261106000000_reports/migration.sql`
- Create: `src/lib/llm.ts`, `src/lib/llm.test.ts`
- Modify: `.env.example` (variables LLM + `CRON_TOKEN`, `REPORT_CRON`)

**Interfaces:**
- Produces: `enum LlmProvider { CLAUDE LOCAL }`, `enum ReportTrigger { MANUAL DAILY }`, `Household.llmProvider LlmProvider?`, `model Report { id, householdId, budgetId, userId String?, day @db.Date, trigger, provider LlmProvider, model String, input Json, output Json?, error String?, createdAt }` (FK household cascade, budget cascade, user SetNull ; index `(householdId, createdAt)`) ; SQL `CREATE UNIQUE INDEX "Report_one_daily" ON "Report"("householdId","day") WHERE "trigger" = 'DAILY';` documenté en commentaire de schéma.
- Produces: `configuredProviders(): LlmProvider[]` ; `pickProvider(pref: LlmProvider | null): LlmProvider | null` ; `class LlmError extends Error` ; `complete(provider: LlmProvider, messages: { system: string; user: string; retry?: { previous: string; error: string } }, schema: object): Promise<{ model: string; text: string }>`.

- [ ] **Step 1: Tests** (`vi.stubGlobal("fetch", …)`, `vi.stubEnv`)
  - `configuredProviders` : `[]` sans env ; `["CLAUDE"]` avec `ANTHROPIC_API_KEY` ; `["CLAUDE","LOCAL"]` avec aussi `LOCAL_LLM_URL`+`LOCAL_LLM_MODEL` ; URL seule ⇒ pas LOCAL.
  - `pickProvider("LOCAL")` sans LOCAL configuré ⇒ `"CLAUDE"` si configuré, sinon `null`.
  - Claude : requête vers `https://api.anthropic.com/v1/messages`, en-têtes `x-api-key`, `anthropic-version: 2023-06-01`, `model` = `claude-sonnet-5-5` par défaut, un outil `rapport` avec `input_schema = schema` et `tool_choice: { type: "tool", name: "rapport" }` ; renvoie `text = JSON.stringify(block.input)` du bloc `tool_use`.
  - Local : `${LOCAL_LLM_URL}/v1/chat/completions` (slash final de l'URL toléré), `response_format: { type: "json_object" }`, `Authorization: Bearer` seulement si `LOCAL_LLM_API_KEY` ; renvoie `choices[0].message.content`.
  - `retry` présent ⇒ messages suivants : assistant = `previous`, user = « Réponse refusée : <error>. Corrige et renvoie le JSON complet. ».
  - HTTP ≠ 2xx ⇒ `LlmError` « Fournisseur LLM : erreur <status> » ; rejet réseau / timeout ⇒ `LlmError` « Fournisseur LLM injoignable ».
- [ ] **Step 2:** `npx vitest run src/lib/llm.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter `llm.ts` ; `AbortSignal.timeout(60_000)` ; `max_tokens: 4096` pour Claude. Schéma Prisma + migration à la main ; `npx prisma generate`.
- [ ] **Step 4:** `npx vitest run src/lib/llm.test.ts` → PASS ; `npm run typecheck` propre ; `npx prisma migrate deploy` sur la base de test passe (via `npm test`).
- [ ] **Step 5:** Commit `feat: rapport — table Report, fournisseurs LLM Claude et local`.

### Task 2: Entrée et validation du rapport (`report.ts`)

**Files:**
- Create: `src/lib/report.ts`, `src/lib/report.test.ts`

**Interfaces:**
- Consumes: `getSplit`, `visibleSplit` (`src/lib/split.ts`), `getBudget`, `envelopes` (`src/lib/budget.ts`), `listMonthCharges` (`src/lib/charges.ts`), `listAccounts`/soldes (`src/lib/ledger.ts`), `getScope`, `fullScope`, `canRead` (`src/lib/access.ts`).
- Produces:
  - `type ReportInput = { today: string; daysLeft: number; month: string; split: Split; envelopes: { id: string; label: string; planned: number; actual: number; left: number; allocatable: boolean }[]; reserve: { id; label; planned; actual; left; overrun; allocatable } | null; available: number; todayOps: Op[]; uncategorized: Op[]; categories: { id: string; name: string; kind: "INCOME" | "EXPENSE" }[]; upcoming: { name: string; amount: number; due: string; account: string }[]; members: { id: string; name: string }[] }` avec `Op = { id: string; label: string; amount: number; kind: "INCOME" | "EXPENSE"; account: string; categoryId: string | null }`.
  - `type ReportOutput = { allocations: { budgetItemId: string; amount: number }[]; categorize: { transactionId: string; categoryId: string }[]; plan: { date: string; budgetItemId: string; label: string; amount: number }[]; balancing: { fromUserId: string; toUserId: string; amount: number; reason: string }[]; advice: string }`.
  - `const OUTPUT_SCHEMA` (JSON Schema de `ReportOutput`, tous champs requis, `additionalProperties: false`).
  - `buildInput(viewer: { id: string; role: Role; householdId: string }, today: Date): Promise<{ budgetId: string; input: ReportInput }>` — `LedgerError("Aucun budget pour ce mois.")` sans budget.
  - `validateOutput(input: ReportInput, text: string): { ok: true; output: ReportOutput } | { ok: false; error: string }` (pure).

- [ ] **Step 1: Tests `validateOutput`** (entrée fixe construite à la main) :
  - JSON valide dont Σ allocations = `available` ⇒ `ok`.
  - texte non JSON ⇒ `{ ok: false, error: "Réponse non JSON." }`.
  - Σ allocations ≠ `available` ⇒ erreur contenant les deux montants.
  - `budgetItemId` non allouable ou inconnu ; `transactionId` absent de `todayOps ∪ uncategorized` ; `categoryId` inconnu ou de kind ≠ kind de l'opération ; `fromUserId`/`toUserId` hors `members` ; montant négatif ou non entier ⇒ `ok: false` avec message nommant l'id.
  - Σ `plan` d'une ligne > son allocation ⇒ `ok: false`.
  - Aucune ligne allouable ⇒ `allocations: []` accepté quel que soit `available`.
- [ ] **Step 2: Tests `buildInput`** (base de test, foyer 2 membres, 1 compte commun, 1 compte perso chacun, budget du mois avec 1 enveloppe feuille, 1 enveloppe avec sous-ligne, 1 réserve) :
  - `available` = solde commun − charge EXPENSE non payée du compte commun ; jamais < 0.
  - enveloppe à sous-ligne ⇒ `allocatable: false`.
  - viewer non-admin sans lecture du compte perso de l'autre : `split.members[autre].income === null`, `personalLeft === null`, et aucune opération de ce compte dans `todayOps`/`uncategorized`.
  - viewer admin : tout présent.
  - `JSON.stringify(input)` ne contient aucun e-mail des membres.
  - Sans budget ⇒ rejette « Aucun budget pour ce mois. ».
- [ ] **Step 3:** `npx vitest run src/lib/report.test.ts` → FAIL.
- [ ] **Step 4:** Implémenter. Split : `getSplit` puis `visibleSplit` avec la portée du viewer (même `ownedBy` que `getVisibleSplit` — extraire la construction de `ownedBy` dans `split.ts` plutôt que la dupliquer). Enveloppes : `getBudget(fullScope)` + `envelopes`. Opérations : portée du viewer ; libellé = note sinon nom de catégorie ; `todayOps` = jour J, `uncategorized` = mois en cours sans catégorie hors ajustements de solde et hors virements.
- [ ] **Step 5:** PASS ; commit `feat: rapport — entrée calculée par l'app et validation de la sortie`.

### Task 3: Génération, stockage, application

**Files:**
- Modify: `src/lib/report.ts`, `src/lib/report.test.ts`

**Interfaces:**
- Consumes: Task 1 `complete`, `pickProvider`, `LlmError` ; Task 2 `buildInput`, `validateOutput`, `OUTPUT_SCHEMA` ; `saveItems` (`budget.ts`), `updateEntry`/`getTransaction` (`ledger.ts`).
- Produces:
  - `generateReport(viewer, today: Date, trigger: ReportTrigger, provider?: LlmProvider): Promise<Report>` — `DAILY` : viewer = admin du foyer, `userId: null`, upsert-free : si un `DAILY` existe déjà pour `(householdId, day)` le renvoyer sans rappeler le LLM (P2002 sur course ⇒ relire et renvoyer).
  - `generateDailyReports(today: Date): Promise<number>` — un rapport `DAILY` par foyer ayant un admin actif et un fournisseur ; renvoie le nombre créé.
  - `listReports(viewer): Promise<Report[]>` — admin : tous du foyer ; membre : les siens (`userId = viewer.id`). Ordre `createdAt desc`, 30 max.
  - `applyAllocations(viewer, reportId): Promise<number>` et `applyCategories(viewer, reportId): Promise<number>` — nombre de lignes / opérations modifiées.
- `SYSTEM_PROMPT` : français, ton du rapport exemple, rappelle que les montants fournis sont exacts et que Σ allocations doit égaler `available`.

- [ ] **Step 1: Tests** (`vi.mock("./llm")` pour `complete`) :
  - sortie valide au 1ᵉʳ appel ⇒ `Report` avec `output`, `error: null`, `complete` appelé 1 fois.
  - invalide puis valide ⇒ 2 appels, le 2ᵉ avec `retry.error` = message de validation ; `output` stocké.
  - invalide deux fois ⇒ `error` = dernier message, `output: null`.
  - `LlmError` ⇒ `Report` avec `error` = message de `LlmError`, pas d'exception.
  - `DAILY` appelé deux fois même jour ⇒ 1 seule ligne, `complete` appelé 1 fois.
  - `listReports` : membre ne voit ni le `DAILY` ni le `MANUAL` de l'autre ; admin voit tout.
  - `applyAllocations` : prévu de la ligne = réel actuel + allocation (réel recalculé à l'application, pas celui stocké) ; ligne supprimée ignorée ; budget `VALIDATED` ⇒ `LedgerError("Repasser le budget en brouillon pour appliquer")` ; rapport d'un autre membre ⇒ `NotFoundError`.
  - `applyCategories` : met à jour `categoryId` via `updateEntry` sous la portée du viewer (opération non modifiable ⇒ ignorée, compte non compté) ; opération supprimée ignorée.
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter. **Step 4:** PASS + `npm run typecheck`.
- [ ] **Step 5:** Commit `feat: rapport — génération avec relance, stockage, application des propositions`.

### Task 4: Déclenchement du soir

**Files:**
- Create: `src/app/api/reports/daily/route.ts`, `src/app/api/reports/daily/route.test.ts`
- Modify: `src/middleware.ts` (matcher exclut `api/`), `docker-compose.yml` (service `cron`, env `app`), `.env.example`, `README.md` (section courte « Rapport LLM »)

**Interfaces:**
- Consumes: `generateDailyReports(today)` ; `todayIn`/`parseDay` (`src/lib/money.ts`) avec le fuseau du conteneur.
- Produces: `POST /api/reports/daily` → `401` sans/mauvais jeton ou `CRON_TOKEN` vide ; `200 { created: n }` sinon.

- [ ] **Step 1: Tests route** (appel direct de `POST(new Request(...))`, `generateDailyReports` mocké) : sans en-tête ⇒ 401 ; `CRON_TOKEN=""` + `Bearer ` ⇒ 401 ; bon jeton ⇒ 200 `{ created: 2 }`. Comparaison du jeton en temps constant (`crypto.timingSafeEqual` sur longueurs égales).
- [ ] **Step 2:** FAIL. **Step 3:** Implémenter route + middleware.
- [ ] **Step 4:** Service compose :

```yaml
  cron:
    image: alpine:3.20
    restart: unless-stopped
    depends_on: [app]
    environment:
      TZ: Europe/Paris
      CRON_TOKEN: ${CRON_TOKEN:-}
      REPORT_CRON: ${REPORT_CRON:-0 20 * * *}
    command: >-
      sh -c 'apk add --no-cache tzdata >/dev/null &&
      echo "$$REPORT_CRON wget -qO- --header \"Authorization: Bearer $$CRON_TOKEN\" --post-data \"\" http://app:3000/api/reports/daily" > /etc/crontabs/root &&
      crond -f -l 8'
```

  `app` reçoit `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `LOCAL_LLM_URL`, `LOCAL_LLM_MODEL`, `LOCAL_LLM_API_KEY`, `CRON_TOKEN`, `TZ: Europe/Paris`.
- [ ] **Step 5:** PASS ; `docker compose config` sans erreur ; commit `feat: rapport du soir — route protégée et service cron`.

### Task 5: Écrans

**Files:**
- Create: `src/app/rapports/page.tsx`, `src/app/rapports/layout.tsx` (comme les autres sections)
- Modify: `src/app/actions.ts` (`analyzeAction`, `applyAllocationsAction`, `applyCategoriesAction`, `updateHouseholdAction` + `llmProvider`), `src/lib/auth.ts` (`updateHousehold` accepte `llmProvider: LlmProvider | null`), `src/app/parametres/page.tsx`, `src/app/tableau-de-bord/page.tsx`, `src/app/nav.tsx` (lien « Rapports » après « Budget »)

**Interfaces:**
- Consumes: `generateReport`, `listReports`, `applyAllocations`, `applyCategories`, `configuredProviders`, `pickProvider`.
- Actions via `run()` existant ; `analyzeAction` lit `provider` facultatif (essai ponctuel) et redirige vers `/rapports`.

- [ ] **Step 1:** Paramètres (carte Foyer, admin) : select « Fournisseur du rapport » limité à `configuredProviders()` ; aucune option ⇒ texte « Aucun fournisseur configuré (ANTHROPIC_API_KEY ou LOCAL_LLM_URL + LOCAL_LLM_MODEL). » ; mention de confidentialité (copie exacte des Global Constraints). Valeur inconnue au POST ⇒ erreur de champ.
- [ ] **Step 2:** `/rapports` : formulaire « Analyser » (+ select fournisseur si 2 configurés) ; dernier rapport : dépenses du jour avec catégorie proposée, budget actualisé (prévu → réel → reste, **chiffres recalculés par l'app au rendu**), tableau enveloppes (prévu, réel, restant, allocation proposée) avec ligne réserve, planning, rééquilibrages (noms des membres), conseil ; rapport en erreur ⇒ bandeau d'erreur ; boutons « Appliquer la répartition » (désactivé + message exact si budget validé) et « Appliquer les catégories » ; historique (date, déclencheur, fournisseur, statut) avec `?id=` pour en ouvrir un.
- [ ] **Step 3:** Tableau de bord : bouton « Analyser » si un fournisseur est configuré.
- [ ] **Step 4:** `npm run typecheck`, `npm test`, `npm run build` verts ; vérification manuelle sur :3003 si l'utilisateur l'autorise (sinon le dire).
- [ ] **Step 5:** Commit `feat: rapports — page, analyse à la demande, réglage du fournisseur`.
