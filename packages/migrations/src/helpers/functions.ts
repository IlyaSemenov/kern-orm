import type { MigrationStep } from "../migration"
import { endLineComment, quoteIdentifier, quoteLiteral } from "../sql"

import { invertStep } from "./step"

/** Parameter of a function: its SQL type, such as `"text"`, or its type with its mode and its SQL default. */
export type FunctionParameter =
  | string
  | {
      readonly type: string
      /** How the function takes the parameter: `"in"`, by default, `"out"`, `"inout"`, or `"variadic"`. */
      readonly mode?: "in" | "out" | "inout" | "variadic"
      /** SQL expression that a call without the parameter takes, such as `"null"`. */
      readonly default?: string
    }

/**
 * Builds a step that creates a function, and drops it on rollback.
 *
 * `parameters` gives each parameter by its name, in order, such as `{ task: "text", payload: { type: "jsonb", default: "null" }, id: { mode: "out", type: "bigint" } }`.
 * `definition` is the SQL of the function after its parameters, such as `"RETURNS integer LANGUAGE sql IMMUTABLE RETURN a + b"`.
 *
 * Rollback drops the function of the types of the parameters, keeping its overloads, and fails when other objects depend on it, such as a trigger.
 * It throws for an invalid parameter.
 */
export function createFunction(
  name: string,
  parameters: Readonly<Record<string, FunctionParameter>>,
  definition: string,
): MigrationStep {
  const checked = checkParameters(name, parameters)
  const signature: string[] = []
  for (const parameter of checked) {
    signature.push(parameter.declaration)
  }
  return {
    up: `CREATE FUNCTION ${defineFunction(name, checked, definition)}`,
    // `DROP FUNCTION` rejects defaults, and ignores the `OUT` parameters.
    down: `DROP FUNCTION ${quoteIdentifier(name)}(${signature.join(", ")})`,
  }
}

/**
 * Builds a step that drops a function, and creates it again on rollback as `createFunction` of the same arguments does.
 *
 * Rollback restores neither the grants on the function nor anything else that the arguments do not describe, such as its comment.
 */
export function dropFunction(
  name: string,
  parameters: Readonly<Record<string, FunctionParameter>>,
  definition: string,
): MigrationStep {
  return invertStep(createFunction(name, parameters, definition))
}

/**
 * Builds a step that replaces the definition of a function from `from` to `to` with `CREATE OR REPLACE FUNCTION`, and restores `from` on rollback the same way.
 *
 * Replacing keeps the owner of the function, the grants on it, and the objects that depend on it, such as triggers, and requires `to` to return the type that the function returns.
 * `parameters` must give the parameters that the function has, as `createFunction` takes them; both directions keep them.
 * To change what `CREATE OR REPLACE FUNCTION` cannot change, such as the types of the parameters or the return type, drop the function with `dropFunction` and create it with `createFunction`.
 * It throws for an invalid parameter.
 */
export function replaceFunction(
  name: string,
  parameters: Readonly<Record<string, FunctionParameter>>,
  from: string,
  to: string,
): MigrationStep {
  const checked = checkParameters(name, parameters)
  const types: string[] = []
  for (const parameter of checked) {
    // PostgreSQL identifies a function by the types of its parameters other than `OUT`.
    if (parameter.mode !== "out") {
      types.push(endLineComment(parameter.type))
    }
  }
  // `CREATE OR REPLACE FUNCTION` creates a missing function, such as of a name with a typo, rather than failing as `DROP FUNCTION` does, so the cast first fails for a function missing from the target schema.
  const check = `SELECT pg_catalog.format('%I.%I(%s)', pg_catalog.current_schema(), ${quoteLiteral(name)}, ${quoteLiteral(types.join(", "))})::pg_catalog.regprocedure\n;\n`
  return {
    up: `${check}CREATE OR REPLACE FUNCTION ${defineFunction(name, checked, to)}`,
    down: `${check}CREATE OR REPLACE FUNCTION ${defineFunction(name, checked, from)}`,
  }
}

/** Builds the definition of a function that follows `CREATE FUNCTION` or `CREATE OR REPLACE FUNCTION`: its name, its parameters with their defaults, and `definition`. */
function defineFunction(
  name: string,
  parameters: readonly CheckedParameter[],
  definition: string,
): string {
  const lines: string[] = []
  for (const parameter of parameters) {
    lines.push(
      parameter.default === undefined
        ? parameter.declaration
        : `${parameter.declaration} DEFAULT ${endLineComment(parameter.default)}`,
    )
  }
  const list = lines.length === 0 ? "()" : `(\n  ${lines.join(",\n  ")}\n)`
  return `${quoteIdentifier(name)}${list} ${definition}`
}

/** Parameter of a function with its mode, `"in"` when the helper had none, its optional SQL default, and its SQL declaration. */
interface CheckedParameter {
  readonly mode: "in" | "out" | "inout" | "variadic"
  readonly type: string
  readonly default: string | undefined
  /** The mode, the quoted name, and the type, as `DROP FUNCTION` takes them. */
  readonly declaration: string
}

const parameterModes: readonly string[] = ["in", "out", "inout", "variadic"]

/**
 * Checks the parameters of a function that a helper takes, and gives each with its mode, its optional default, and its SQL declaration.
 *
 * It throws for an invalid parameter, such as from JavaScript, which would otherwise fail only when the step runs, such as on rollback of `dropFunction`.
 */
function checkParameters(
  name: string,
  parameters: Readonly<Record<string, FunctionParameter>>,
): CheckedParameter[] {
  const result: CheckedParameter[] = []
  for (const [parameter, value] of Object.entries(parameters)) {
    const describe = (problem: string) =>
      new Error(`Invalid parameter ${parameter} of function ${name}: ${problem}`)
    const {
      type,
      mode = "in",
      default: defaultValue,
    } = typeof value === "string" ? { type: value } : value
    if (typeof type !== "string") {
      throw describe("type must be a string")
    }
    if (!parameterModes.includes(mode)) {
      throw describe("mode must be in, out, inout, or variadic")
    }
    if (defaultValue !== undefined && typeof defaultValue !== "string") {
      throw describe("default must be a string")
    }
    // PostgreSQL rejects it only when the step runs, such as on rollback of `dropFunction`, after the function is gone.
    if (defaultValue !== undefined && mode === "out") {
      throw describe("an out parameter takes no default")
    }
    const prefix = mode === "in" ? "" : `${mode.toUpperCase()} `
    result.push({
      mode,
      type,
      default: defaultValue,
      declaration: `${prefix}${quoteIdentifier(parameter)} ${endLineComment(type)}`,
    })
  }
  return result
}
