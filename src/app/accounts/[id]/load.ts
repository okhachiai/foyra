import { notFound } from "next/navigation";
import { getAccount, NotFoundError } from "@/lib/ledger";

/** getAccount, avec 404 si le compte n'existe pas ou n'appartient pas au foyer. */
export async function loadAccount(householdId: string, id: string) {
  try {
    return await getAccount(householdId, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}
