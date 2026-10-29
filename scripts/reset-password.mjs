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
    console.error(`Aucun utilisateur avec l'email « ${email} ». Rien n'a été modifié.`);
    process.exitCode = 1;
  } else {
    const password = randomBytes(12).toString("base64url");
    const passwordHash = await hash(password); // mêmes options que hashPassword (src/lib/auth.ts)
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);
    console.log(`Nouveau mot de passe provisoire pour ${email} : ${password}`);
    console.log("Il ne sera plus affiché. Changez-le après connexion dans « Mon compte ».");
    if (user.disabledAt) console.log("Attention : ce compte est désactivé ; un admin doit le réactiver.");
  }
} finally {
  await prisma.$disconnect();
}
