# Budget lié aux comptes, partage au prorata et rapport LLM — conception

Date : 2026-10-29

## Intention

Aujourd'hui le budget du mois (`Budget` / `BudgetItem`) ne sait pas d'où vient l'argent : les charges fixes et les opérations sont rattachées à un compte, les lignes de budget non. Le foyer (deux membres) a un compte joint alimenté par les deux, et chacun paie aussi certaines factures / abonnements communs depuis son compte personnel.

Objectif : savoir chaque mois **qui doit payer combien** pour les dépenses communes, **au prorata des salaires**, en tenant compte de ce que chacun paie déjà en perso, puis suivre les enveloppes variables au jour le jour. Un LLM (Claude via API, ou LLM local) produit ensuite un rapport — à la demande ou chaque soir à 20:00 — qui propose la répartition du reste sur les enveloppes, classe les dépenses, signale les déséquilibres et conseille. Modèle de rapport visé : dépenses du jour → budget actualisé → restant par enveloppe avec réserve imprévus qui absorbe les dépassements → planning éventuel (ex. dates de courses) → conseil.

## Principes

- **On fait évoluer l'existant**, on ne réécrit pas : arbre de budget, reprise du mois précédent, réel par ligne (`getBudget`), charges fixes, crédits, calendrier, tableau de bord restent tels quels. Migrations additives avec valeurs par défaut ; sans réglage, l'app se comporte comme aujourd'hui.
- **L'app calcule, le LLM propose.** Tous les montants (soldes, parts, restes, dépassements) sont calculés par des fonctions pures testées. Le LLM ne reçoit que des chiffres déjà calculés et renvoie une proposition structurée que l'app valide (sommes exactes au centime, identifiants existants) avant affichage.
- **Rien n'est écrit sans confirmation.** Le rapport est consultatif ; appliquer une répartition ou des catégories est une action explicite de l'utilisateur.
- Montants en centimes (`Int`), comme partout.

## Non-objectifs

- Synchronisation bancaire, virements automatiques, notifications push / e-mail.
- Règle 50/50 ou montant fixe : seul le prorata des salaires est demandé.
- Plus de deux membres « payeurs » n'est pas visé, mais le calcul est écrit pour N membres (rien de spécifique à 2).

## Anti-objectifs (échec même si « ça marche »)

- Un montant affiché faux parce que le LLM l'a calculé.
- Perte ou réécriture des fonctionnalités budget / charges / crédits existantes.
- Le LLM qui modifie des données sans action de l'utilisateur.
- Envoyer à l'API externe des données d'identification (e-mails, mots de passe, notes privées hors libellés).

---

## Phase A — Comptes liés au budget, partage au prorata (sans LLM)

Utile seule. Livrée et testée avant la phase B.

### Schéma (additif)

| Changement | Rôle | Défaut |
|---|---|---|
| `Account.ownerId String?` → `User` | Propriétaire du compte. `null` = compte commun (joint). Distinct de `sharing` / `AccountAccess` (droits) | `null` |
| `FixedCharge.shared Boolean` | Charge commune ou personnelle | `true` |
| `Transaction.shared Boolean` | Dépense / recette commune ou personnelle | fixé à la création, voir règles |
| `BudgetItem.shared Boolean` | Ligne commune ou personnelle | `true` |
| `BudgetItem.reserve Boolean` | Ligne « Réserve imprévus » (au plus une par budget, index unique partiel SQL) | `false` |

Règles :
- Une charge, opération ou ligne sur un **compte commun** est toujours commune (contrainte appliquée dans le code d'écriture ; le formulaire masque la case).
- Opération saisie sur un **compte personnel** : par défaut personnelle, case « Dépense commune » dans le formulaire (ex. courses avancées).
- Paiement d'une charge fixe (« marquer payée ») : l'opération créée hérite de `FixedCharge.shared`.
- Les charges fixes et crédits ne sont pas des lignes de budget (lus en direct) : leur compte et `shared` viennent de `FixedCharge`. La reprise du mois précédent (`carryOver`) recopie `shared` et `reserve`.
- Virements : jamais comptés comme dépense ; un virement d'un compte personnel vers un compte commun est une **contribution** de son propriétaire.

### Droits et visibilité (décidé par l'utilisateur)

Le modèle de droits existant est conservé tel quel : l'admin du foyer gère tous les comptes (CRUD), chaque membre gère ses comptes (`MANAGE`) et les partage avec d'autres (`READ` / `WRITE` / `MANAGE`, page `partage`).

- `ownerId` est proposé par défaut au créateur du compte (option « Commun » disponible) ; modifiable par l'admin ou un gestionnaire (`MANAGE`) du compte.
- Le **calcul** du partage tourne toujours avec la portée foyer complète (`fullScope`), sinon les chiffres seraient faux.
- L'**affichage** respecte les droits : l'admin voit tout le détail. Un membre voit le détail (opérations, soldes) des comptes qu'il peut lire ; pour les comptes privés d'un autre membre, il ne voit que les agrégats de ce membre : part %, dû, contribution, reste à virer — pas le salaire, pas les dépenses perso, pas le reste perso.
- Même règle pour le rapport LLM : un rapport généré pour un membre non-admin n'envoie au LLM et n'affiche que ces agrégats pour les comptes qu'il ne peut pas lire. Le rapport du soir est généré avec le détail complet et visible par l'admin ; chaque membre peut générer le sien à la demande.

### Revenus et parts

- Revenu d'un membre pour le mois M = somme des opérations `INCOME` **catégorisées** du mois sur ses comptes personnels (hors virements). Les ajustements de solde (sans catégorie) sont exclus. *(choix du concepteur)*
- Recettes arrivant sur un compte commun (aides, etc.) : déduites des dépenses communes avant partage. *(choix du concepteur)* Tant qu'aucun revenu réel n'est saisi pour un membre, on prend le prévisionnel : lignes `INCOME` du budget rattachées à un de ses comptes.
- Part d'un membre = son revenu / somme des revenus des membres. Recalculée chaque mois → une prime ajuste la répartition.
- Arrondi : parts calculées au centime, le reliquat d'arrondi va au membre au revenu le plus élevé (somme exacte garantie).

### Calcul du mois — `src/lib/split.ts` (pur, testé)

Entrées : membres, comptes (avec propriétaire), lignes de budget dépense communes, opérations du mois (avec `shared`), virements du mois.

```
Dépenses communes prévues = Σ lignes EXPENSE incluses et communes du budget
                          − recettes catégorisées des comptes communs (mois M)
Part due (m)              = Dépenses communes prévues × part(m)
Contribution (m)          = virements de ses comptes perso → comptes communs (mois M)
                          + dépenses communes payées depuis ses comptes perso (mois M)
Reste à virer (m)         = Part due(m) − Contribution(m)   (négatif = a avancé trop)
Reste personnel (m)       = revenu(m) − Part due(m) − dépenses perso du mois
```

Sortie : par membre `{ revenu, part, dû, contribution, resteAVirer, restePerso }` + totaux. Fonction pure + un test Vitest couvrant : prorata 60/40, facture commune payée en perso, courses avancées, arrondi, membre sans revenu saisi (prévisionnel).

### Enveloppes et réserve — dans `src/lib/budget.ts`

Réutilise le réel par ligne déjà calculé par `getBudget`, avec un seul ajustement : le réel d'une ligne commune ne compte que les opérations communes de sa catégorie, celui d'une ligne personnelle que les opérations personnelles. Sinon des courses perso feraient déborder l'enveloppe commune. *(choix du concepteur)*
- restant(ligne) = prévu − réel.
- Dépassement d'une ligne variable commune (réel > prévu) : absorbé par la ligne `reserve`. `réserve restante = réserve prévue − Σ dépassements`.
- Fonction pure `envelopes(items)` + test.

### Attribution d'un propriétaire à un compte existant

Après migration tous les comptes sont communs et toutes les opérations `shared = true`. Quand on donne un propriétaire à un compte, les opérations de ce compte du **mois en cours** qui ne sont pas des paiements de charge fixe passent en `shared = false` (l'utilisateur peut recocher « commune » au cas par cas). Les mois antérieurs ne sont pas touchés. Les charges fixes du compte gardent `shared = true` (factures communes payées en perso) ; l'utilisateur décoche les personnelles. *(choix du concepteur)*

### Saisie du solde (rapprochement)

Sur la page d'un compte : « Ajuster le solde » — l'utilisateur saisit le solde réel ; si différent du solde calculé (`accountBalance`), l'app crée une opération `INCOME`/`EXPENSE` de l'écart, note « Ajustement de solde », sans catégorie, personnelle si compte perso. Pas de nouvelle table.

### Écrans

- **Compte** (création / édition) : champ « Propriétaire » (Commun / membre).
- **Charge fixe** : case « Charge commune » (masquée si compte commun).
- **Saisie d'opération** : case « Dépense commune » si compte perso.
- **Budget du mois** : case « Commune » et marqueur « Réserve » par ligne. Nouveau bloc **Partage** : pour chaque membre revenu, part %, dû, déjà contribué, reste à virer, avec bouton « Préparer le virement » (ouvre le formulaire de virement existant pré-rempli : de son compte perso principal vers le compte commun, montant = reste à virer). Bloc **Enveloppes** : restant par ligne variable + réserve restante.
- **Tableau de bord** : carte « Reste à virer » par membre.

---

## Phase B — Rapport LLM

### Fournisseurs

Deux fournisseurs, appelés par `fetch` (aucune nouvelle dépendance) dans `src/lib/llm.ts` :
- **Claude** : API Messages Anthropic. Env : `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (défaut `claude-sonnet-5-5`). Sortie structurée via outil / schéma JSON.
- **Local** : endpoint compatible OpenAI (`/v1/chat/completions` — Ollama, LM Studio, llama.cpp). Env : `LOCAL_LLM_URL`, `LOCAL_LLM_MODEL`, `LOCAL_LLM_API_KEY` facultatif. `response_format` JSON.

Choix : `Household.llmProvider` (`CLAUDE` | `LOCAL`) réglé dans **Paramètres** ; seuls les fournisseurs configurés (env présente) sont proposés. Le bouton « Analyser » permet de choisir l'autre fournisseur pour un essai ponctuel. Mention en Paramètres : en mode Claude, montants, libellés, catégories et prénoms des membres sont envoyés à Anthropic ; en mode local rien ne sort du serveur.

### Entrée envoyée au LLM (calculée par l'app)

JSON : date du jour, jours restants dans le mois, résultat de `split` (phase A), enveloppes (id de ligne, libellé, prévu, réel, restant), réserve, reste commun disponible (solde des comptes communs − charges communes restant à payer ce mois), opérations du jour et opérations non catégorisées (id, libellé/note, montant, compte), catégories (id, nom), charges fixes à venir ce mois. Pas d'e-mail ni d'identifiant de connexion.

### Sortie attendue (schéma validé par l'app)

```
{
  allocations: [{ budgetItemId, amount }],   // Σ = reste commun disponible, au centime
  categorize:  [{ transactionId, categoryId }],
  plan:        [{ date, label, amount }],    // facultatif (ex. courses)
  balancing:   [{ fromUserId, toUserId, amount, reason }],
  advice:      string
}
```

Validation : identifiants existants dans le foyer, montants entiers ≥ 0, Σ allocations = reste commun disponible, Σ plan d'une enveloppe ≤ son allocation. Échec → une nouvelle tentative avec l'erreur renvoyée au modèle, puis rapport enregistré en erreur (affiché comme tel).

### Stockage — table `Report`

`id, householdId, budgetId, day (Date), trigger (MANUAL | DAILY), provider, model, input Json, output Json?, error String?, createdAt`. Unicité `(householdId, day)` pour `DAILY` (index partiel SQL) : un seul rapport du soir par jour, relance sans doublon.

### Écran — `/rapports`

Dernier rapport + historique. Rendu dans l'esprit de l'exemple : dépenses du jour (avec catégorie proposée), budget actualisé (départ → dépenses → reste réel), tableau des enveloppes avec réserve, planning, conseil, rééquilibrages entre membres. Les montants « actuels » affichés viennent toujours du calcul de l'app ; seules les propositions viennent du LLM. Boutons : « Appliquer la répartition » (nouveau prévu de chaque ligne = réel actuel + allocation, via `saveItems`, pour que « restant = prévu − réel » reste juste ; désactivé si le budget est validé, avec le message « Repasser le budget en brouillon pour appliquer ») *(choix du concepteur)*, « Appliquer les catégories » (met à jour les opérations). Accès : voir « Droits et visibilité » (phase A).

### Déclenchement

- **À la demande** : bouton « Analyser » (tableau de bord et `/rapports`), action serveur.
- **Chaque soir à 20:00** : service `cron` dans `docker-compose.yml` (image alpine, `crond`, `TZ=Europe/Paris`) qui appelle `POST /api/reports/daily` avec `Authorization: Bearer $CRON_TOKEN`. La route génère le rapport `DAILY` de chaque foyer (idempotent). Heure configurable via `REPORT_CRON` (défaut `0 20 * * *`). Fuseau : celui du conteneur ; `Household.timezone` non utilisé pour l'heure du déclenchement (instance mono-foyer).

---

## Laissé au constructeur

- Mise en page exacte des nouveaux blocs (suivre les composants existants `src/components/`).
- Rédaction du prompt système (français, ton du rapport exemple).
- Nom exact des migrations, découpage des commits.
- Gestion des erreurs réseau LLM (timeout raisonnable, message clair).
