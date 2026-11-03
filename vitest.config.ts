// Runs the tests of `bun:test` under Vitest on Node.js, so that they also check the Node.js implementation of `AsyncLocalStorage`.
import { existsSync } from "node:fs"

import { defineConfig } from "vitest/config"

// Like `bun test`, read the variables of the tests, such as `DATABASE_URL`, from `.env.test.local` and not from `.env.local`; variables of the environment take precedence.
if (existsSync(".env.test.local")) {
  process.loadEnvFile(".env.test.local")
}

export default defineConfig({
  // Keeps Vite from reading `.env.local` and other env files into `import.meta.env`.
  envDir: false,
  resolve: {
    // Workspace packages resolve to their sources, as under Bun.
    tsconfigPaths: true,
    alias: { "bun:test": "vitest" },
  },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/tests/**/*.test.ts",
      "examples/*/tests/**/*.test.ts",
      "benchmarks/**/*.test.ts",
    ],
    setupFiles: ["./vitest.setup.ts"],
    // Fixtures of several test files create the same tables and PostgreSQL schemas, so the files run one after another, as under `bun test`.
    fileParallelism: false,
  },
})
