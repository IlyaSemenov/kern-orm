import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts", "src/testing.ts"],
  format: "esm",
  dts: true,
  exports: true,
  publint: true,
  attw: {
    profile: "esm-only",
  },
})
