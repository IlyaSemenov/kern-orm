import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/testing.ts", "src/types.ts", "src/db.ts", "src/db/types.ts"],
  format: "esm",
  dts: true,
  exports: true,
  publint: true,
  attw: {
    profile: "esm-only",
  },
})
