// Command `new`: the module of the next migration, and the list module of the migration modules of the directory.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path"

import { moduleExtensions } from "../files"
import { compareMigrationNumbers, getMigrationNumber } from "../history"

/** Options of the list module that the command `new` writes. */
export interface MigrationListModuleOptions {
  /** Path of the module, absolute or relative to the working directory, or its `file:` URL. */
  readonly path: string | URL
  /** Whether import specifiers keep the extension of the migration modules, such as `./0001_create_form.ts`; `true` by default. */
  readonly extensions?: boolean
}

/** Options of `createMigration`, with resolved paths. */
export interface CreateMigrationOptions {
  readonly directory: string
  readonly listModule: { readonly path: string; readonly extensions: boolean } | undefined
  readonly template: (key: string) => string
}

/** Migration module of a directory. */
interface MigrationModule {
  readonly key: string
  readonly number: bigint
  readonly fileName: string
}

/** First line of the list module, by which `new` recognizes a module that it may write. */
const listModuleHeader = "// Written by the new command of @kern-orm/migrations"

/** Text of a new migration module, whose blank `up` and `down` fail to load until they are filled in. */
export function getDefaultTemplate(): string {
  return `import { defineMigration } from "@kern-orm/migrations"

export default defineMigration({
  up: "",
  down: "",
})
`
}

/**
 * Creates the module of the next migration named `name` in the directory, and then writes the list module, if any; returns the paths that it wrote.
 *
 * The number of the migration follows the greatest number of `keys` and of the modules of the directory, with as many digits as the key of that number.
 * It checks the list module and builds its text before it creates the migration, so that a list module written by hand or a module that the list cannot import fails without writing anything.
 * It writes the list from the modules of the directory listed again after it creates the migration, so that the list keeps a migration that another `new` has created meanwhile, and two migrations of one number fail.
 */
export async function createMigration(
  keys: readonly string[],
  name: string,
  options: CreateMigrationOptions,
): Promise<string[]> {
  const { directory, listModule } = options
  if (listModule !== undefined) {
    await checkListModule(listModule.path)
  }
  const modules = await listMigrationModules(directory)
  const key = getNextKey([...keys, ...modules.map(module => module.key)], name)
  const fileName = `${key}.ts`
  if (listModule !== undefined) {
    formatListModule(
      [...modules, { key, number: getMigrationNumber(key)!, fileName }],
      directory,
      listModule,
    )
  }
  await mkdir(directory, { recursive: true })
  const path = join(directory, fileName)
  // The `wx` flag never overwrites a file, such as one that another process has created meanwhile.
  await writeFile(path, options.template(key), { flag: "wx" })
  if (listModule === undefined) {
    return [path]
  }
  const text = formatListModule(await listMigrationModules(directory), directory, listModule)
  await mkdir(dirname(listModule.path), { recursive: true })
  await writeFile(listModule.path, text)
  return [path, listModule.path]
}

/**
 * Lists the migration modules of `directory` in the order of their numbers, and none of a missing directory.
 *
 * A module is a file with the extension of a module whose name without the extension is a key, such as `0001_create_form.ts`; other files, such as `index.ts` and migration tests `*.migration-test.ts`, are not.
 * It rejects two modules of one key or one number, such as of two branches that took one number.
 */
export async function listMigrationModules(directory: string): Promise<MigrationModule[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (Reflect.get(Object(error), "code") === "ENOENT") {
      return []
    }
    throw error
  }
  const modules: MigrationModule[] = []
  for (const entry of entries) {
    const extension = extname(entry.name)
    if (!entry.isFile() || !moduleExtensions.has(extension)) {
      continue
    }
    const key = entry.name.slice(0, -extension.length)
    const number = getMigrationNumber(key)
    if (number !== undefined) {
      modules.push({ key, number, fileName: entry.name })
    }
  }
  // File names order modules of one number, so that the error names them in the same order on every file system.
  modules.sort(
    (left, right) =>
      compareMigrationNumbers(left.number, right.number) ||
      (left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0),
  )
  for (let index = 1; index < modules.length; index++) {
    const previous = modules[index - 1]!
    const module = modules[index]!
    if (previous.number === module.number) {
      throw new Error(
        `Migrations ${previous.fileName} and ${module.fileName} have the same number: give each migration its own number`,
      )
    }
  }
  return modules
}

/** Returns the key of the migration named `name` that follows the greatest number of `keys`, such as `0010_add_form_slug` after `0009_create_tag`, or `0001_…` without keys. */
function getNextKey(keys: readonly string[], name: string): string {
  let last: { key: string; number: bigint } | undefined
  for (const key of keys) {
    const number = getMigrationNumber(key)
    if (number !== undefined && (last === undefined || number > last.number)) {
      last = { key, number }
    }
  }
  if (last === undefined) {
    return `0001_${name}`
  }
  const digits = last.key.indexOf("_")
  return `${String(last.number + 1n).padStart(digits, "0")}_${name}`
}

/**
 * Rejects a list module that `new` must not write: one named as a migration module, which would replace the migration of its key, and one that exists without the header line, so that `new` never overwrites a module written by hand.
 *
 * It reads the header line without the `\r` of a line ending converted to CRLF, such as by a checkout on Windows.
 */
async function checkListModule(path: string): Promise<void> {
  const fileName = basename(path)
  if (
    getMigrationNumber(fileName.slice(0, fileName.length - extname(fileName).length)) !== undefined
  ) {
    throw new Error(
      `Cannot write the list of migrations to ${path}: name it other than a migration, such as index.ts`,
    )
  }
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    if (Reflect.get(Object(error), "code") === "ENOENT") {
      return
    }
    throw error
  }
  const firstLine = text.split("\n", 1)[0]!
  if (firstLine.replace(/\r$/, "") !== listModuleHeader) {
    throw new Error(
      `Cannot write the list of migrations to ${path}: the new command writes only a module that starts with the line "${listModuleHeader}"; add the line at the top of the module to let the command write it`,
    )
  }
}

/**
 * Formats the list module: the default export of the loaders of `modules` by key, with import specifiers relative to the list module.
 *
 * It rejects a specifier with `#`, `?`, or `%` rather than escaping it, since Node.js reads a specifier as a URL, and Bun and bundlers read it as a path.
 * It rejects a module that has no relative path from the list module, such as on a different Windows drive.
 */
function formatListModule(
  modules: readonly MigrationModule[],
  directory: string,
  listModule: { readonly path: string; readonly extensions: boolean },
): string {
  const lines = [listModuleHeader, "export default {"]
  for (const module of modules) {
    const fileName = listModule.extensions
      ? module.fileName
      : module.fileName.slice(0, -extname(module.fileName).length)
    const relativePath = relative(dirname(listModule.path), join(directory, fileName))
    // On Windows, `relative` returns the absolute path of a module on another drive.
    if (isAbsolute(relativePath)) {
      throw new Error(
        `Cannot import ${relativePath} from the list of migrations at ${listModule.path}: put the list module on the drive of the migrations`,
      )
    }
    const path = relativePath.split(sep).join("/")
    const specifier = path.startsWith("../") ? path : `./${path}`
    if (/[#?%]/.test(specifier)) {
      throw new Error(
        `Cannot import ${specifier} from the list of migrations: an import specifier must not have #, ?, or %`,
      )
    }
    lines.push(`  ${JSON.stringify(module.key)}: () => import(${JSON.stringify(specifier)}),`)
  }
  lines.push("}", "")
  return lines.join("\n")
}
