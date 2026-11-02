import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { loadMigrationTests } from "./test-files"

const keys = ["0001_create_form", "0002_add_form_slug"]

const test = { name: "fills slugs", setup: async () => {} }

/** Returns the names of the tests of each group of files of migration tests by key. */
function getTestNames(groups: Awaited<ReturnType<typeof loadMigrationTests>>) {
  const names: Record<string, string[]> = {}
  for (const [key, files] of groups) {
    names[key] = files.flatMap(file => file.tests.map(test => `${file.path}: ${test.name}`))
  }
  return names
}

describe("in a directory", () => {
  let directory: string

  beforeEach(async () => {
    directory = join(await mkdtemp(join(tmpdir(), "kern-migration-tests-")), "migrations")
    await mkdir(directory)
  })

  afterEach(async () => {
    await rm(join(directory, ".."), { recursive: true, force: true })
  })

  /** Writes a file of `directory` that exports `exported` by default, with plain JavaScript. */
  async function writeTestFile(fileName: string, exported: string): Promise<void> {
    await writeFile(join(directory, fileName), `export default ${exported}\n`)
  }

  it("loads the files of migration tests of a path or a URL in the order of their names, and skips the other files", async () => {
    await writeTestFile("0001_create_form.mjs", '{ up: "CREATE TABLE form ()" }')
    await writeTestFile(
      "0002_add_form_slug.migration-test.mjs",
      '{ name: "fills slugs", setup() {} }',
    )
    await writeTestFile(
      "0002_add_form_slug.edge-cases.migration-test.ts",
      '[{ name: "keeps slugs", setup() {} }, { name: "fills blank slugs", setup() {} }]',
    )
    await writeTestFile("index.ts", "{}")
    await mkdir(join(directory, "0001_create_form.migration-test.ts"))

    const expected = {
      "0002_add_form_slug": [
        "0002_add_form_slug.edge-cases.migration-test.ts: keeps slugs",
        "0002_add_form_slug.edge-cases.migration-test.ts: fills blank slugs",
        "0002_add_form_slug.migration-test.mjs: fills slugs",
      ],
    }
    expect(getTestNames(await loadMigrationTests(directory, keys))).toEqual(expected)
    expect(getTestNames(await loadMigrationTests(pathToFileURL(`${directory}/`), keys))).toEqual(
      expected,
    )
  })

  it("rejects a file of a migration that the history lacks before it loads any file", async () => {
    await writeTestFile(
      "0002_add_form_slug.migration-test.mjs",
      "(() => { throw new Error('loaded') })()",
    )
    await writeTestFile("0003_create_tag.migration-test.mjs", "{}")

    await expect(loadMigrationTests(directory, keys)).rejects.toThrow(
      "File of migration tests 0003_create_tag.migration-test.mjs matches no migration of the history: name it <key>.migration-test.ts or <key>.<name>.migration-test.ts after the key of its migration",
    )
  })

  it("rejects a file that fails to load, keeping its error in cause", async () => {
    await writeTestFile(
      "0002_add_form_slug.migration-test.mjs",
      "(() => { throw new Error('broken') })()",
    )

    const error = await loadMigrationTests(directory, keys).catch((error: unknown) => error)

    expect(error).toMatchObject({
      message: "Cannot load migration tests 0002_add_form_slug.migration-test.mjs: broken",
      cause: { message: "broken" },
    })
  })

  it("rejects a missing directory", async () => {
    await expect(loadMigrationTests(join(directory, "missing"), keys)).rejects.toMatchObject({
      code: "ENOENT",
    })
  })
})

describe("by path", () => {
  it("loads the modules and the functions that import them by path, as import.meta.glob returns them", async () => {
    const groups = await loadMigrationTests(
      {
        "./migrations/0002_add_form_slug.migration-test.ts": { default: test },
        "./migrations/0001_create_form.migration-test.ts": async () => ({
          default: [{ name: "creates forms", assertUp: async () => {} }],
        }),
      },
      keys,
    )

    expect(getTestNames(groups)).toEqual({
      "0001_create_form": ["./migrations/0001_create_form.migration-test.ts: creates forms"],
      "0002_add_form_slug": ["./migrations/0002_add_form_slug.migration-test.ts: fills slugs"],
    })
  })

  it("rejects a path of a name of another form, such as of a migration that the pattern matches", async () => {
    await expect(
      loadMigrationTests({ "./migrations/0001_create_form.ts": { default: test } }, keys),
    ).rejects.toThrow(
      "./migrations/0001_create_form.ts is not a file of migration tests: name it <key>.migration-test.ts or <key>.<name>.migration-test.ts after the key of its migration",
    )
  })

  it.each([
    [
      {},
      "must export a migration test or a non-empty array of migration tests as its default export",
    ],
    [
      { default: [] },
      "must export a migration test or a non-empty array of migration tests as its default export",
    ],
    [
      { default: "SELECT 1" },
      "must export a migration test or a non-empty array of migration tests as its default export",
    ],
  ])("rejects module %o", async (module, problem) => {
    await expect(
      loadMigrationTests({ "./0001_create_form.migration-test.ts": module }, keys),
    ).rejects.toThrow(`./0001_create_form.migration-test.ts ${problem}`)
  })

  it("rejects a value of the array that is not a migration test, naming its position", async () => {
    await expect(
      loadMigrationTests(
        {
          "./0001_create_form.migration-test.ts": {
            default: [test, { ...test, assertDonw: test.setup }],
          },
        },
        keys,
      ),
    ).rejects.toThrow(
      "Migration test 2 of ./0001_create_form.migration-test.ts has unknown property assertDonw",
    )
  })
})
