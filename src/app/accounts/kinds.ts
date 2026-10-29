import type { AccountKind } from "@prisma/client";

export const KIND_LABELS: Record<AccountKind, string> = {
  CHECKING: "Compte courant",
  SAVINGS: "Épargne",
  CASH: "Espèces",
  OTHER: "Autre",
};
