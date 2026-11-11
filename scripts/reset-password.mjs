// Réinitialise le mot de passe d'un utilisateur : `npm run reset-password [email]`
// (Docker : `docker compose exec app npm run reset-password admin@exemple.fr`).
// Nouveau mot de passe aléatoire affiché une seule fois ; toutes les sessions sont supprimées ; un compte désactivé le reste.
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";

let email = process.argv[2];
if (!email) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  email = await rl.question("Email de l'utilisateur : ");
  rl.close();
}
email = email.trim().toLowerCase();

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with the email "${email}". Nothing was changed.`);
    process.exitCode = 1;
  } else {
    const password = randomBytes(12).toString("base64url");
    const passwordHash = await hash(password); // mêmes options que hashPassword (src/lib/auth.ts)
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);
    console.log(`New temporary password for ${email}: ${password}`);
    console.log("It will not be shown again. Change it after signing in, under Settings → Security.");
    if (user.disabledAt) console.log("Warning: this account is disabled; an admin must reactivate it.");
  }
} finally {
  await prisma.$disconnect();
}
