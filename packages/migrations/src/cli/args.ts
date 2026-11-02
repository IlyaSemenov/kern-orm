// Arguments of the command line: a command with its arguments and options.
import { parseArgs } from "node:util"

/** Command of the arguments of the command line. */
export type CliCommand =
  | { readonly name: "help"; readonly requested: boolean }
  | {
      readonly name: "migrate" | "redo"
      readonly count: number | undefined
      readonly schemaName: string | undefined
    }
  | {
      readonly name: "rollback"
      readonly count: number | "all" | undefined
      readonly schemaName: string | undefined
    }
  | { readonly name: "status"; readonly schemaName: string | undefined }
  | { readonly name: "new"; readonly migrationName: string }

/** Error of the arguments of the command line, which the command line reports with a hint to `--help`. */
export class CliUsageError extends Error {
  override readonly name = "CliUsageError"
}

/** Text of `--help`. */
export const usage = `Usage: <script> <command> [options]

Commands:
  migrate [count]         Apply the pending migrations, or the first count of them
  rollback [count | all]  Roll back the last applied migration, the last count of them, or all
  redo [count]            Roll back the last applied migration, or the last count of them, and apply them again
  status                  List the applied and the pending migrations
  new <name>              Create the module of the next migration

Options:
  -s, --schema <name>     PostgreSQL schema to migrate instead of that of the database
  -h, --help              Show this help`

/**
 * Parses the arguments of the command line, such as `["rollback", "2", "--schema", "tenant_acme"]`.
 *
 * It returns `help` for `--help` and for arguments without a command, and throws a `CliUsageError` for arguments of another form.
 */
export function parseCliArgs(args: readonly string[]): CliCommand {
  const { values, positionals } = parseOptions(args)
  if (values.help) {
    return { name: "help", requested: true }
  }
  const command = positionals[0]
  const commandArgs = positionals.slice(1)
  const schemaName = values.schema
  if (schemaName === "") {
    throw new CliUsageError("--schema requires the name of a PostgreSQL schema")
  }
  switch (command) {
    case undefined:
      return { name: "help", requested: false }
    case "migrate":
    case "redo": {
      const arg = getCountArg(command, commandArgs)
      return {
        name: command,
        count: arg === undefined ? undefined : parseCount(command, arg, false),
        schemaName,
      }
    }
    case "rollback": {
      const arg = getCountArg(command, commandArgs)
      return {
        name: command,
        count: arg === undefined || arg === "all" ? arg : parseCount(command, arg, true),
        schemaName,
      }
    }
    case "status":
      if (commandArgs.length > 0) {
        throw new CliUsageError("status takes no arguments")
      }
      return { name: command, schemaName }
    case "new":
      if (schemaName !== undefined) {
        throw new CliUsageError("new takes no --schema")
      }
      return { name: command, migrationName: parseMigrationName(commandArgs) }
    default:
      throw new CliUsageError(`Unknown command ${command}`)
  }
}

/** Parses the options and the positional arguments, throwing a `CliUsageError` for an unknown option or an option without its value. */
function parseOptions(args: readonly string[]) {
  try {
    return parseArgs({
      args: [...args],
      options: {
        schema: { type: "string", short: "s" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    })
  } catch (error) {
    // `parseArgs` throws a `TypeError` with a code of `ERR_PARSE_ARGS_*` for arguments it rejects.
    if (
      error instanceof TypeError &&
      String(Reflect.get(error, "code")).startsWith("ERR_PARSE_ARGS_")
    ) {
      throw new CliUsageError(error.message)
    }
    throw error
  }
}

/** Returns the optional count argument of `command`, rejecting more arguments. */
function getCountArg(command: string, args: readonly string[]): string | undefined {
  if (args.length > 1) {
    throw new CliUsageError(`${command} takes one count at most`)
  }
  return args[0]
}

/** Parses the count argument of `command`: decimal digits of a positive safe integer, so that `0x10`, `1e3`, and `02` are not counts. */
function parseCount(command: string, arg: string, allowsAll: boolean): number {
  const count = Number(arg)
  if (!/^[1-9]\d*$/.test(arg) || !Number.isSafeInteger(count)) {
    throw new CliUsageError(
      `The count of ${command} must be a positive integer${allowsAll ? " or all" : ""}, not ${arg}`,
    )
  }
  return count
}

/** Parses the name of a new migration, the `<name>` of its key `<number>_<name>`. */
function parseMigrationName(args: readonly string[]): string {
  const name = args[0]
  if (name === undefined || args.length > 1) {
    throw new CliUsageError("new takes the name of the migration, such as new add_form_slug")
  }
  // Letters, digits, `_`, and `-` make a key, a file name on every file system, and an import specifier.
  if (!/^[\p{L}\p{N}_-]+$/u.test(name)) {
    throw new CliUsageError(
      `The name of a migration must have only letters, digits, _, and -, such as add_form_slug, not ${name}`,
    )
  }
  return name
}
