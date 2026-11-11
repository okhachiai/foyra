// Démarrage du conteneur (image distroless, sans shell) : migrations Prisma puis serveur Next standalone.
import { execFileSync } from "node:child_process";

execFileSync(
  process.execPath,
  ["/prisma-cli/node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "./prisma/schema.prisma"],
  { stdio: "inherit" },
);
await import("./server.js");
