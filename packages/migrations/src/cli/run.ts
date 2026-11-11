// Command line of a history on a target: runs the command of the arguments and prints its result.
import { relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import type { Database } from "kern-db"

import { getErrorMessage } from "../error"
import type { MigrationHistory } from "../history"
import { getMigrationStatus, migrate, redo, rollback } from "../migrate"
import type { MigrationTarget } from "../target"
import { isMigrationTargetDb } from "../target"

import { CliUsageError, parseCliArgs, usage } from "./args"
import type { MigrationListModuleOptions } from "./new"
import { createMigration, getDefaultTemplate } from "./new"

/** Options of `runMigrationCli`. */
export interface MigrationCliOptions {
  /** Directory of the migration modules, where the command `new` creates one: a path, absolute or relative to the working directory, or a `file:` URL. */
  readonly directory?: string | URL
  /** Module that the command `new` writes with the loaders of the migration modules of `directory`, for runtimes without `import.meta.glob`: its path or URL, or its options. */
  readonly listModule?: string | URL | MigrationListModuleOptions
  /** Returns the text of a new migration module by its key, such as `0003_add_form_slug`. */
  readonly template?: (key: string) => string
  /** Arguments of the command, `process.argv.slice(2)` by default. */
  readonly args?: readonly string[]
}

/** Output of the command line: `log` prints a line of a result, and `error` an error. */
export interface CliOutput {
  log(text: string): void
  error(value: unknown): void
}

/**
 * Runs the command of the arguments of the process on `target` with the migrations of `history`, such as `migrate` or `rollback 2`, and prints its result.
 *
 * It never rejects: it prints an error to stderr and sets `process.exitCode` to 1, so that the script closes the database after it.
 * It does not close the database, which belongs to the script.
 */
export async function runMigrationCli(
  target: MigrationTarget,
  history: MigrationHistory,
  options: MigrationCliOptions = {},
): Promise<void> {
  const exitCode = await runCli(target, history, options, {
    log: text => console.log(text),
    error: value => console.error(value),
  })
  if (exitCode !== 0) {
    process.exitCode = exitCode
  }
}

/** Runs the command of `options.args` and prints its result to `output`; resolves to the exit code. */
export async function runCli(
  target: MigrationTarget,
  history: MigrationHistory,
  options: MigrationCliOptions,
  output: CliOutput,
): Promise<number> {
  try {
    const command = parseCliArgs(options.args ?? process.argv.slice(2))
    switch (command.name) {
      case "help":
        if (!command.requested) {
          output.error(usage)
          return 1
        }
        output.log(usage)
        return 0
      case "migrate": {
        const { database, schemaName } = resolveTarget(target, command.schemaName)
        const keys = await migrate(database, history, { count: command.count, schemaName })
        logKeys(output, "Applied", keys, "No pending migrations")
        return 0
      }
      case "rollback": {
        const { database, schemaName } = resolveTarget(target, command.schemaName)
        const keys = await rollback(database, history, { count: command.count, schemaName })
        logKeys(output, "Rolled back", keys, "No applied migrations")
        return 0
      }
      case "redo": {
        const { database, schemaName } = resolveTarget(target, command.schemaName)
        const keys = await redo(database, history, { count: command.count, schemaName })
        logKeys(output, "Rolled back", keys.toReversed(), "No applied migrations")
        logKeys(output, "Applied", keys)
        return 0
      }
      case "status": {
        const { database, schemaName } = resolveTarget(target, command.schemaName)
        const status = await getMigrationStatus(database, history, { schemaName })
        const applied = new Set(status.applied)
        output.log(`Migrations of schema "${status.schemaName}":`)
        for (const key of history.keys) {
          output.log(`  ${applied.has(key) ? "applied" : "pending"}  ${key}`)
        }
        for (const key of status.unknown) {
          output.log(`  unknown  ${key}`)
        }
        return 0
      }
      case "new": {
        if (options.directory === undefined) {
          throw new Error("The command new requires the directory option of runMigrationCli")
        }
        const listModule =
          typeof options.listModule === "string" || options.listModule instanceof URL
            ? { path: options.listModule }
            : options.listModule
        const paths = await createMigration(history.keys, command.migrationName, {
          directory: resolvePath(options.directory),
          listModule:
            listModule === undefined
              ? undefined
              : { path: resolvePath(listModule.path), extensions: listModule.extensions ?? true },
          template: options.template ?? getDefaultTemplate,
        })
        output.log(`Created ${relative(process.cwd(), paths[0]!)}`)
        if (paths[1] !== undefined) {
          output.log(`Wrote ${relative(process.cwd(), paths[1])}`)
        }
        return 0
      }
    }
  } catch (error) {
    output.error(
      error instanceof CliUsageError
        ? `${error.message}\nRun with --help to list the commands.`
        : error,
    )
    return 1
  }
}

/**
 * Resolves the database and the PostgreSQL schema of a command: the schema of `--schema`, otherwise that of a `Db`, or `undefined` for `current_schema()`.
 *
 * It reads `$schemaName` of a `Db` once, and the command passes the calls the database with that schema, so that no call reads it again.
 * When the function of the schema throws, such as of the current tenant, which a command line has no context for, the error names `--schema`.
 */
function resolveTarget(
  target: MigrationTarget,
  schemaName: string | undefined,
): { database: Database; schemaName: string | undefined } {
  if (!isMigrationTargetDb(target)) {
    return { database: target, schemaName }
  }
  const database = target.$database
  if (schemaName !== undefined) {
    return { database, schemaName }
  }
  try {
    return { database, schemaName: target.$schemaName }
  } catch (error) {
    throw new Error(
      `Cannot resolve the PostgreSQL schema of the target: ${getErrorMessage(error)}; pass --schema`,
      { cause: error },
    )
  }
}

/** Prints a line of `verb` for each key, or `empty` without keys. */
function logKeys(output: CliOutput, verb: string, keys: readonly string[], empty?: string): void {
  if (keys.length === 0 && empty !== undefined) {
    output.log(empty)
  }
  for (const key of keys) {
    output.log(`${verb} ${key}`)
  }
}

/** Resolves a path of an option, absolute or relative to the working directory, or a `file:` URL. */
function resolvePath(path: string | URL): string {
  return resolve(path instanceof URL ? fileURLToPath(path) : path)
}
