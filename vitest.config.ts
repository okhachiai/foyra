import { defineConfig } from "vitest/config";

process.env.DATABASE_URL_TEST ??= "postgresql://foyra:foyra@localhost:5433/foyra_test";

export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: {
    env: { DATABASE_URL: process.env.DATABASE_URL_TEST },
    globalSetup: "./vitest.setup.ts",
    fileParallelism: false,
  },
});
