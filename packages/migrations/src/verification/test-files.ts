// Files of migration tests: found in a directory or given by path as `import.meta.glob` returns them, and bound to the migrations of a history by their names.
import { readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { getErrorMessage } from "../error"
import { getMigrationTestKey } from "../files"

import type { MigrationTest } from "./migration-test"
import { findMigrationTestProblem } from "./migration-test"

/**
 * Files of migration tests: their directory, a path absolute or relative to the working directory or a `file:` URL, or their modules or the functions that import them by path, as `import.meta.glob` returns them.
 *
 * The file of the tests of a migration is named `<key>.migration-test.<extension>` or `<key>.<name>.migration-test.<extension>`, such as `0003_add_form_slug.migration-test.ts`.
 */
export type MigrationTestFiles = string | URL | Readonly<Record<string, unknown>>

/** File of migration tests with its tests. */
export interface MigrationTestFile {
  /** Name of the file in its directory, or its path as `import.meta.glob` gives it. */
  readonly path: string
  readonly tests: readonly MigrationTest[]
}

/** File of migration tests before it loads. */
interface PendingFile {
  readonly path: string
  readonly fileName: string
  readonly load: () => unknown
}

/**
 * Loads the files of migration tests and groups them by the key of their migration, each group in the order of the file names.
 *
 * It rejects a path of a name of another form, a file of a migration that `keys` lack, and a file that does not export migration tests before any test runs.
 */
export async function loadMigrationTests(
  files: MigrationTestFiles,
  keys: readonly string[],
): Promise<Map<string, MigrationTestFile[]>> {
  const pending =
    typeof files === "string" || files instanceof URL
      ? await listDirectory(files)
      : listModules(files)
  pending.sort((left, right) =>
    left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0,
  )
  const known = new Set(keys)
  for (const file of pending) {
    if (!known.has(getMigrationTestKey(file.fileName)!)) {
      throw new Error(
        `File of migration tests ${file.path} matches no migration of the history: name it <key>.migration-test.ts or <key>.<name>.migration-test.ts after the key of its migration`,
      )
    }
  }
  const byKey = new Map<string, MigrationTestFile[]>()
  for (const file of pending) {
    const key = getMigrationTestKey(file.fileName)!
    let group = byKey.get(key)
    if (group === undefined) {
      group = []
      byKey.set(key, group)
    }
    group.push({ path: file.path, tests: await loadFile(file) })
  }
  return byKey
}

/** Lists the files of migration tests of a directory, skipping its other files, such as the migration modules. */
async function listDirectory(directory: string | URL): Promise<PendingFile[]> {
  const path = resolve(directory instanceof URL ? fileURLToPath(directory) : directory)
  const files: PendingFile[] = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isFile() && getMigrationTestKey(entry.name) !== undefined) {
      // A file URL keeps an absolute path importable on Windows.
      const url = pathToFileURL(join(path, entry.name)).href
      files.push({ path: entry.name, fileName: entry.name, load: () => import(url) })
    }
  }
  return files
}

/** Lists the files of migration tests of the modules by path, rejecting a path of a name of another form. */
function listModules(modules: Readonly<Record<string, unknown>>): PendingFile[] {
  const files: PendingFile[] = []
  for (const [path, value] of Object.entries(modules)) {
    const fileName = path.slice(path.lastIndexOf("/") + 1)
    if (getMigrationTestKey(fileName) === undefined) {
      throw new Error(
        `${path} is not a file of migration tests: name it <key>.migration-test.ts or <key>.<name>.migration-test.ts after the key of its migration`,
      )
    }
    files.push({
      path,
      fileName,
      load: typeof value === "function" ? (value as () => unknown) : () => value,
    })
  }
  return files
}

/** Loads a file of migration tests and returns its tests, rejecting a module that does not export a test or a non-empty array of tests. */
async function loadFile(file: PendingFile): Promise<MigrationTest[]> {
  let module: unknown
  try {
    module = await file.load()
  } catch (error) {
    throw new Error(`Cannot load migration tests ${file.path}: ${getErrorMessage(error)}`, {
      cause: error,
    })
  }
  const value =
    typeof module === "object" && module !== null
      ? (module as { default?: unknown }).default
      : undefined
  const tests: readonly unknown[] = Array.isArray(value) ? value : [value]
  if (typeof value !== "object" || value === null || tests.length === 0) {
    throw new Error(
      `${file.path} must export a migration test or a non-empty array of migration tests as its default export`,
    )
  }
  for (let index = 0; index < tests.length; index++) {
    const problem = findMigrationTestProblem(tests[index])
    if (problem !== undefined) {
      throw new Error(`Migration test ${index + 1} of ${file.path} ${problem}`)
    }
  }
  return tests as MigrationTest[]
}
