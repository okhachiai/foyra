import { execSync } from "node:child_process";

// Applique les migrations sur la base de test (`docker compose --profile test up -d db-test`).
export default function setup() {
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST } });
}
