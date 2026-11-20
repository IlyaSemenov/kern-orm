import type { MigrationStep } from "../migration"
import { quoteIdentifier, quoteLiteral } from "../sql"

import { invertStep } from "./step"

/** Options of `createView`, `dropView`, and `replaceView`. */
export interface ViewOptions {
  /** Rejects a row that an insert or an update through the view writes unless the condition of the view selects it: `"local"` checks the condition of this view, and `"cascaded"` also those of the views it selects from. */
  checkOption?: "local" | "cascaded"
  /** Keeps the functions and operators of a query on the view that are not `LEAKPROOF` from seeing the rows that the conditions of the view hide, by applying those conditions first. */
  securityBarrier?: boolean
  /** Checks the privileges and row-level security policies of the tables of the view against the user of the query rather than the owner of the view. */
  securityInvoker?: boolean
}

/** Options of `replaceView`. */
export interface ReplaceViewOptions extends ViewOptions {
  /**
   * How rollback restores the query of the view: `"replace"`, by default, restores the previous query as `up` replaces it, which keeps the view; `"recreate"` drops the view and creates it again, for a change that PostgreSQL cannot replace back, such as when `to` appends columns.
   *
   * Recreating the view loses what the query and the options do not describe, such as its grants, comment, and triggers, and fails when other views depend on it.
   */
  rollback?: "replace" | "recreate"
}

/**
 * Builds a step that creates a view of a SQL query, such as `"SELECT id, name FROM form WHERE published"`, and drops it on rollback.
 *
 * Rollback fails when other views depend on the view.
 * It throws for an invalid value of an option.
 */
export function createView(name: string, query: string, options: ViewOptions = {}): MigrationStep {
  return {
    up: `CREATE VIEW ${defineView(name, query, options)}`,
    down: `DROP VIEW ${quoteIdentifier(name)}`,
  }
}

/**
 * Builds a step that drops a view, and creates it again on rollback as `createView` of the same arguments does.
 *
 * `query` must give the columns that the view has.
 * When the view was created of `*` and the table has gained columns since, list the columns of the view in `query`.
 * Rollback restores neither the grants on the view nor anything else that the query and the options do not describe, such as its comment and triggers.
 */
export function dropView(name: string, query: string, options: ViewOptions = {}): MigrationStep {
  return invertStep(createView(name, query, options))
}

/**
 * Builds a step that replaces the query of a view from `from` to `to` with `CREATE OR REPLACE VIEW`, and restores `from` on rollback as `rollback` chooses.
 *
 * Replacing keeps the grants on the view, its comment, and its triggers, and requires `to` to give the columns of the view with the same names, types, and collations in the same order, followed by any new columns.
 * To change the columns otherwise, drop the view with `dropView` and create it with `createView`.
 * `from` must give the columns that the view has.
 * When the view was created of `*` and the table has gained columns since, list the columns of the view in `from`.
 *
 * Both directions set the options of the view to those of the step, since `CREATE OR REPLACE VIEW` replaces the options that the view has.
 * It throws for an unknown `rollback` and for an invalid value of an option.
 */
export function replaceView(
  name: string,
  from: string,
  to: string,
  options: ReplaceViewOptions = {},
): MigrationStep {
  const { rollback = "replace" } = options
  if (rollback !== "replace" && rollback !== "recreate") {
    throw new Error(`Cannot replace view ${name}: unknown rollback ${String(rollback)}`)
  }
  // `CREATE OR REPLACE VIEW` creates a missing view, such as of a name with a typo, rather than failing as `DROP VIEW` does, so the cast first fails for a relation missing from the target schema.
  const check = `SELECT pg_catalog.format('%I.%I', pg_catalog.current_schema(), ${quoteLiteral(name)})::pg_catalog.regclass\n;\n`
  return {
    up: `${check}CREATE OR REPLACE VIEW ${defineView(name, to, options)}`,
    down:
      rollback === "replace"
        ? `${check}CREATE OR REPLACE VIEW ${defineView(name, from, options)}`
        : `DROP VIEW ${quoteIdentifier(name)}\n;\nCREATE VIEW ${defineView(name, from, options)}`,
  }
}

// Options of a view that take a Boolean, with the parameters of PostgreSQL that set them.
const booleanParameters = [
  ["securityBarrier", "security_barrier"],
  ["securityInvoker", "security_invoker"],
] as const

/**
 * Builds the definition of a view that follows `CREATE VIEW` or `CREATE OR REPLACE VIEW`: its name, the options that `options` gives, and its query.
 *
 * It throws for an invalid value of an option, such as from JavaScript, which would otherwise fail only when the step runs, such as on rollback of `dropView`.
 */
function defineView(name: string, query: string, options: ViewOptions): string {
  const parameters: string[] = []
  const { checkOption } = options
  if (checkOption !== undefined) {
    if (checkOption !== "local" && checkOption !== "cascaded") {
      throw new Error(`Invalid options of view ${name}: checkOption must be local or cascaded`)
    }
    parameters.push(`check_option = '${checkOption}'`)
  }
  for (const [option, parameter] of booleanParameters) {
    const value = options[option]
    if (value !== undefined) {
      if (typeof value !== "boolean") {
        throw new Error(`Invalid options of view ${name}: ${option} must be a Boolean`)
      }
      parameters.push(`${parameter} = ${value}`)
    }
  }
  // The options go in `WITH` before the query rather than in `WITH CHECK OPTION` after it, which a query that ends with a line comment would comment out.
  const parameterList = parameters.length === 0 ? "" : ` WITH (${parameters.join(", ")})`
  return `${quoteIdentifier(name)}${parameterList} AS ${query}`
}
