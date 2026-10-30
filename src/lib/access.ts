/**
 * Portée d'un utilisateur : tout le foyer. Sans comptes bancaires, chaque membre lit et modifie
 * budgets, opérations, charges et crédits du foyer (les réglages restent réservés aux admins, cf. auth.ts).
 */
export type Scope = { householdId: string };

export const fullScope = (householdId: string): Scope => ({ householdId });

export const getScope = async (user: { householdId: string }): Promise<Scope> => fullScope(user.householdId);
