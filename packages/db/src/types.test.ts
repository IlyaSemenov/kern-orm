import { expect, it } from "bun:test"
import { fileURLToPath } from "node:url"

import { build } from "esbuild"

it("loads only the modules of codecs", async () => {
  const sources = fileURLToPath(new URL(".", import.meta.url))
  const { metafile } = await build({
    entryPoints: ["./types.ts"],
    absWorkingDir: sources,
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  })

  const modules = Object.keys(metafile.inputs).filter(path => path !== "types.ts")
  // No other module of kern-db, such as the transaction coordinator.
  expect(modules.filter(path => !path.startsWith("codec/") && !path.startsWith("codecs/"))).toEqual(
    [],
  )
  expect(modules).toContain("codecs/datetime.ts")
})
