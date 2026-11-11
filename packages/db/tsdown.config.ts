import { defineConfig } from "tsdown"

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/builder.ts",
    "src/node-postgres.ts",
    "src/postgres-js.ts",
    "src/testing.ts",
    "src/types.ts",
  ],
  format: "esm",
  dts: true,
  exports: true,
  publint: true,
  attw: {
    profile: "esm-only",
  },
})
