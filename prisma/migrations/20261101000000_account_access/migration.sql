-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('READ', 'WRITE');

-- CreateTable
CREATE TABLE "AccountAccess" (
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "level" "AccessLevel" NOT NULL,

    CONSTRAINT "AccountAccess_pkey" PRIMARY KEY ("userId","accountId")
);

-- CreateIndex
CREATE INDEX "AccountAccess_accountId_idx" ON "AccountAccess"("accountId");

-- AddForeignKey
ALTER TABLE "AccountAccess" ADD CONSTRAINT "AccountAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAccess" ADD CONSTRAINT "AccountAccess_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- DefaultAccess : les membres existants gardent l'accès complet (écriture) à chaque compte existant de leur foyer.
INSERT INTO "AccountAccess" ("userId", "accountId", "level")
SELECT u."id", a."id", 'WRITE'::"AccessLevel"
FROM "User" u JOIN "Account" a ON a."householdId" = u."householdId"
WHERE u."role" = 'MEMBER'
ON CONFLICT DO NOTHING;
