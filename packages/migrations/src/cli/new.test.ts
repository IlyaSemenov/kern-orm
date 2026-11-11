import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { writeFileSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CreateMigrationOptions } from "./new"
import { createMigration, getDefaultTemplate, listMigrationModules } from "./new"

let root: string
let directory: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kern-migrations-"))
  directory = join(root, "migrations")
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Writes files of `directory` by name, with empty text. */
async function writeFiles(...names: string[]): Promise<void> {
  await mkdir(directory, { recursive: true })
  for (const name of names) {
    await writeFile(join(directory, name), "")
  }
}

/** Options of `createMigration` in `directory`, without a list module. */
function getOptions(options: Partial<CreateMigrationOptions> = {}): CreateMigrationOptions {
  return { directory, listModule: undefined, template: getDefaultTemplate, ...options }
}

describe("createMigration", () => {
  it("creates the module of the first migration from the default template in a missing directory", async () => {
    const paths = await createMigration([], "create_form", getOptions())

    expect(paths).toEqual([join(directory, "0001_create_form.ts")])
    expect(await readFile(paths[0]!, "utf8"))
      .toBe(`import { createTable, defineMigration } from "kern-migrations"

export default defineMigration([
  createTable(/* table */ "", {
    id: "uuid PRIMARY KEY DEFAULT gen_random_uuid()",
  }),
])
`)
  })

  it("creates the module of a later migration from the default template of adding a column", async () => {
    const [path] = await createMigration(["0001_create_form"], "add_form_slug", getOptions())

    expect(await readFile(path!, "utf8"))
      .toBe(`import { addColumn, defineMigration } from "kern-migrations"

export default defineMigration([
  addColumn(/* table */ "", /* column */ "", "text"),
])
`)
  })

  it("numbers the migration after the greatest number of the history and the directory, with the digits of its key", async () => {
    await writeFiles("0002_create_user.ts", "0009_create_tag.js")

    const fromDirectory = await createMigration(["0001_create_form"], "add_form_slug", getOptions())
    const fromHistory = await createMigration(["123_from_history"], "add_tag_slug", getOptions())

    expect(fromDirectory).toEqual([join(directory, "0010_add_form_slug.ts")])
    expect(fromHistory).toEqual([join(directory, "124_add_tag_slug.ts")])
  })

  it("creates the module from the template of the options by its key", async () => {
    const [path] = await createMigration(
      [],
      "create_form",
      getOptions({ template: key => `// ${key}\n` }),
    )

    expect(await readFile(path!, "utf8")).toBe("// 0001_create_form\n")
  })

  describe("list module", () => {
    it("writes the loaders of the modules of the directory into a list module inside it", async () => {
      await writeFiles("0001_create_form.ts", "0002_create_user.js")
      const listModule = { path: join(directory, "index.ts"), extensions: true }

      const paths = await createMigration([], "add_form_slug", getOptions({ listModule }))

      expect(paths).toEqual([join(directory, "0003_add_form_slug.ts"), listModule.path])
      expect(await readFile(listModule.path, "utf8"))
        .toBe(`// Written by the new command of kern-migrations
export default {
  "0001_create_form": () => import("./0001_create_form.ts"),
  "0002_create_user": () => import("./0002_create_user.js"),
  "0003_add_form_slug": () => import("./0003_add_form_slug.ts"),
}
`)
    })

    it("writes import specifiers relative to a list module outside the directory, without extensions when they are off", async () => {
      const outside = { path: join(root, "migrations.ts"), extensions: false }
      // The directory of this list module is missing, and `new` creates it.
      const sibling = { path: join(root, "lists/migrations.ts"), extensions: true }

      await createMigration([], "create_form", getOptions({ listModule: outside }))
      await createMigration([], "create_user", getOptions({ listModule: sibling }))

      expect(await readFile(outside.path, "utf8")).toContain(
        `  "0001_create_form": () => import("./migrations/0001_create_form"),\n}`,
      )
      expect(await readFile(sibling.path, "utf8")).toContain(
        `  "0001_create_form": () => import("../migrations/0001_create_form.ts"),\n  "0002_create_user": () => import("../migrations/0002_create_user.ts"),\n}`,
      )
    })

    it("writes again a list module that it has written", async () => {
      const listModule = { path: join(directory, "index.ts"), extensions: true }

      await createMigration([], "create_form", getOptions({ listModule }))
      await createMigration([], "create_user", getOptions({ listModule }))

      expect(await readFile(listModule.path, "utf8")).toContain(
        `  "0001_create_form": () => import("./0001_create_form.ts"),\n  "0002_create_user": () => import("./0002_create_user.ts"),\n}`,
      )
    })

    it("lists the modules of the directory again after it creates the migration, and fails on a module of its number that another new has created meanwhile", async () => {
      const listModule = { path: join(directory, "index.ts"), extensions: true }
      await writeFiles("0001_create_form.ts")

      await expect(
        createMigration(
          [],
          "create_user",
          getOptions({
            listModule,
            // Another `new` creates a migration of the same number after this one has chosen its number.
            template: key => {
              writeFileSync(join(directory, "0002_create_tag.ts"), "")
              return `// ${key}\n`
            },
          }),
        ),
      ).rejects.toThrow(
        "Migrations 0002_create_tag.ts and 0002_create_user.ts have the same number: give each migration its own number",
      )
    })

    it("writes again a list module whose line endings are CRLF, such as after a checkout on Windows", async () => {
      const listModule = { path: join(directory, "index.ts"), extensions: true }
      await mkdir(directory)
      await writeFile(
        listModule.path,
        "// Written by the new command of kern-migrations\r\nexport default {}\r\n",
      )

      await createMigration([], "create_form", getOptions({ listModule }))

      expect(await readFile(listModule.path, "utf8")).toContain(
        `  "0001_create_form": () => import("./0001_create_form.ts"),\n}`,
      )
    })

    it("writes nothing when the list module exists without its header line, such as a list written by hand", async () => {
      const listModule = { path: join(directory, "index.ts"), extensions: true }
      await mkdir(directory)
      await writeFile(
        listModule.path,
        'export default { "0001_create_form": () => import("./0001_create_form") }\n',
      )

      await expect(createMigration([], "create_form", getOptions({ listModule }))).rejects.toThrow(
        `Cannot write the list of migrations to ${listModule.path}: the new command writes only a module that starts with the line "// Written by the new command of kern-migrations"; add the line at the top of the module to let the command write it`,
      )
      expect(await readdir(directory)).toEqual(["index.ts"])
    })

    it("writes nothing when the list module is named as a migration, whose module it would replace", async () => {
      const listModule = { path: join(directory, "0001_create_form.ts"), extensions: true }

      await expect(createMigration([], "create_form", getOptions({ listModule }))).rejects.toThrow(
        `Cannot write the list of migrations to ${listModule.path}: name it other than a migration, such as index.ts`,
      )
      expect(await readdir(root)).toEqual([])
    })

    it("writes nothing when an import specifier would have #, which Node.js reads as a fragment", async () => {
      const listModule = { path: join(root, "migrations.ts"), extensions: true }

      await expect(
        createMigration(
          [],
          "create_form",
          getOptions({ directory: join(root, "#migrations"), listModule }),
        ),
      ).rejects.toThrow(
        "Cannot import ./#migrations/0001_create_form.ts from the list of migrations: an import specifier must not have #, ?, or %",
      )
      expect(await readdir(root)).toEqual([])
    })
  })
})

describe("listMigrationModules", () => {
  it("lists the files of the directory whose name without the extension of a module is a key, in the order of their numbers", async () => {
    await writeFiles(
      "10_create_tag.mjs",
      "0002_create_user.js",
      "0001_create_form.ts",
      "0001_create_form.migration-test.ts",
      "0001_create_form.d.ts",
      "0003_notes.md",
      "index.ts",
    )
    await mkdir(join(directory, "0004_fixtures"))

    const modules = await listMigrationModules(directory)

    expect(modules.map(module => module.fileName)).toEqual([
      "0001_create_form.ts",
      "0002_create_user.js",
      "10_create_tag.mjs",
    ])
  })

  it("lists no modules of a missing directory", async () => {
    expect(await listMigrationModules(directory)).toEqual([])
  })

  it.each([
    [
      "one number",
      ["0002_create_user.ts", "2_create_tag.ts"],
      "0002_create_user.ts and 2_create_tag.ts",
    ],
    [
      "one key",
      ["0002_create_user.js", "0002_create_user.ts"],
      "0002_create_user.js and 0002_create_user.ts",
    ],
  ])("rejects two modules of %s", async (_, names, files) => {
    await writeFiles(...names)

    await expect(listMigrationModules(directory)).rejects.toThrow(
      `Migrations ${files} have the same number: give each migration its own number`,
    )
  })
})
