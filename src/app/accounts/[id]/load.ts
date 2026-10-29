import { notFound } from "next/navigation";
import { canManage, canWrite, type Scope } from "@/lib/access";
import { getAccount, NotFoundError } from "@/lib/ledger";

/** getAccount avec 404 si le compte n'existe pas, n'est pas lisible, ou n'atteint pas le niveau demandé. */
export async function loadAccount(scope: Scope, id: string, level: "READ" | "WRITE" | "MANAGE") {
  try {
    const account = await getAccount(scope, id);
    if (level === "WRITE" && !canWrite(scope, account.id)) notFound();
    if (level === "MANAGE" && !canManage(scope, account.id)) notFound();
    return account;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}
