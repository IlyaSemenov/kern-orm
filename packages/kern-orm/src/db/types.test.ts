import { expect, it } from "bun:test"
import { fileURLToPath } from "node:url"

import { build } from "esbuild"

it("loads only the modules of codecs of the database layer", async () => {
  const sources = fileURLToPath(new URL("..", import.meta.url))
  const { metafile } = await build({
    entryPoints: ["db/types.ts"],
    absWorkingDir: sources,
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  })

  const modules = Object.keys(metafile.inputs).filter(path => path !== "db/types.ts")
  // Neither the ORM nor the rest of the layer, such as the transaction coordinator.
  expect(
    modules.filter(
      path => !path.startsWith("database/codec/") && !path.startsWith("database/codecs/"),
    ),
  ).toEqual([])
  expect(modules).toContain("database/codecs/datetime.ts")
})
