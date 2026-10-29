import { notFound } from "next/navigation";
import { canWrite, type Scope } from "@/lib/access";
import { getAccount, NotFoundError } from "@/lib/ledger";

/** getAccount avec 404 si le compte n'existe pas, n'est pas lisible, ou (level WRITE) n'est pas modifiable. */
export async function loadAccount(scope: Scope, id: string, level: "READ" | "WRITE") {
  try {
    const account = await getAccount(scope, id);
    if (level === "WRITE" && !canWrite(scope, account.id)) notFound();
    return account;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}
