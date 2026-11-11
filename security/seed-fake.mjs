// Données FICTIVES pour l'instance d'audit (security/audit.sh up) : deux foyers isolés, chacun ADMIN + MEMBER.
// Exécuté dans le conteneur app : node --input-type=module < security/seed-fake.mjs
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";

const PASSWORD = "Audit-Foyra-2026!";
const prisma = new PrismaClient();

async function household(tag) {
  const passwordHash = await hash(PASSWORD);
  const h = await prisma.household.create({ data: { name: `Foyer fictif ${tag}` } });
  const [admin, member] = await Promise.all(
    ["ADMIN", "MEMBER"].map((role) =>
      prisma.user.create({
        data: { householdId: h.id, role, passwordHash, name: `${role} ${tag}`, email: `${role.toLowerCase()}-${tag}@example.test` },
      }),
    ),
  );
  const [salaire, courses] = await Promise.all([
    prisma.category.create({ data: { householdId: h.id, kind: "INCOME", name: "Salaire" } }),
    prisma.category.create({ data: { householdId: h.id, kind: "EXPENSE", name: "Courses" } }),
  ]);
  const now = new Date();
  const day = (d) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d));
  await prisma.transaction.createMany({
    data: [
      { kind: "INCOME", amount: 250000, categoryId: salaire.id, paidById: admin.id, occurredOn: day(1), note: "Salaire fictif" },
      { kind: "EXPENSE", amount: 8450, categoryId: courses.id, paidById: member.id, occurredOn: day(2), note: "Courses fictives" },
      { kind: "EXPENSE", amount: 3210, categoryId: courses.id, paidById: admin.id, occurredOn: day(3), note: "<script>alert(1)</script>" },
    ].map((t) => ({ ...t, householdId: h.id, createdById: t.paidById })),
  });
  await prisma.budget.create({
    data: {
      householdId: h.id,
      month: day(1),
      items: {
        create: [
          { householdId: h.id, kind: "INCOME", label: "Salaire", amount: 250000, categoryId: salaire.id },
          { householdId: h.id, kind: "EXPENSE", label: "Courses", amount: 40000, categoryId: courses.id },
        ],
      },
    },
  });
}

try {
  if (await prisma.user.findUnique({ where: { email: "admin-a@example.test" } })) {
    console.log("Fake data already present.");
  } else {
    await household("a");
    await household("b");
    console.log(`Comptes fictifs : {admin,member}-{a,b}@example.test / ${PASSWORD}`);
  }
} finally {
  await prisma.$disconnect();
}
