import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import { describePostgres } from "../../testing/postgres"
import { defineMigrations } from "../history"
import { runChange } from "../migration"
import { createMigrationSearchPath } from "../target"
import { verifyMigrations } from "../verification/verify"

import { createFunction, dropFunction, replaceFunction } from "./functions"
import { combineSteps, invertStep } from "./step"
import { applyStep, helperSchema } from "./testing"

const addDefinition = "RETURNS integer LANGUAGE sql IMMUTABLE RETURN a + b"

const addParameters = {
  a: "integer",
  b: "integer",
}

const checkSum = `SELECT pg_catalog.format('%I.%I(%s)', pg_catalog.current_schema(), 'sum', 'integer, integer[]')::pg_catalog.regprocedure`

describe("createFunction", () => {
  it("creates a function of quoted names of parameters, and drops it by their types", () => {
    expect(createFunction("add", addParameters, addDefinition)).toEqual({
      up: `CREATE FUNCTION "add"(\n  "a" integer,\n  "b" integer\n) ${addDefinition}`,
      down: 'DROP FUNCTION "add"("a" integer, "b" integer)',
    })
  })

  it("creates a function without parameters", () => {
    expect(createFunction("now_utc", {}, "RETURNS timestamp LANGUAGE sql RETURN now()")).toEqual({
      up: 'CREATE FUNCTION "now_utc"() RETURNS timestamp LANGUAGE sql RETURN now()',
      down: 'DROP FUNCTION "now_utc"()',
    })
  })

  it("creates parameters with their modes and defaults, and drops the function without the defaults", () => {
    expect(
      createFunction(
        "enqueue",
        {
          task: "text",
          payload: { type: "jsonb", default: "null" },
          tags: { mode: "variadic", type: "text[]", default: "'{}'" },
          id: { mode: "out", type: "bigint" },
        },
        "LANGUAGE sql BEGIN ATOMIC SELECT 1; END",
      ),
    ).toEqual({
      up: `CREATE FUNCTION "enqueue"(\n  "task" text,\n  "payload" jsonb DEFAULT null,\n  VARIADIC "tags" text[] DEFAULT '{}',\n  OUT "id" bigint\n) LANGUAGE sql BEGIN ATOMIC SELECT 1; END`,
      down: 'DROP FUNCTION "enqueue"("task" text, "payload" jsonb, VARIADIC "tags" text[], OUT "id" bigint)',
    })
  })

  it("ends a type or a default with a line comment with a line break, so that the comment does not comment out the SQL after it", () => {
    expect(
      createFunction(
        "convert",
        {
          rate: "numeric -- per unit",
          amount: { type: "numeric -- in cents", default: "0 -- none" },
        },
        "RETURNS numeric LANGUAGE sql RETURN amount * rate",
      ),
    ).toEqual({
      up: 'CREATE FUNCTION "convert"(\n  "rate" numeric -- per unit\n,\n  "amount" numeric -- in cents\n DEFAULT 0 -- none\n\n) RETURNS numeric LANGUAGE sql RETURN amount * rate',
      down: 'DROP FUNCTION "convert"("rate" numeric -- per unit\n, "amount" numeric -- in cents\n)',
    })
  })

  it("throws for an invalid parameter", () => {
    expect(
      getThrownError(() =>
        createFunction("f", { a: { type: "integer", mode: "output" as never } }, addDefinition),
      ),
    ).toEqual(
      new Error("Invalid parameter a of function f: mode must be in, out, inout, or variadic"),
    )
    expect(
      getThrownError(() =>
        createFunction("f", { a: { type: "integer", default: 0 as never } }, addDefinition),
      ),
    ).toEqual(new Error("Invalid parameter a of function f: default must be a string"))
    expect(getThrownError(() => createFunction("f", { a: {} as never }, addDefinition))).toEqual(
      new Error("Invalid parameter a of function f: type must be a string"),
    )
  })
})

describe("dropFunction", () => {
  it("drops a function, and creates it again as createFunction does", () => {
    expect(
      dropFunction(
        "add",
        {
          a: "integer",
          b: { type: "integer", default: "0" },
        },
        addDefinition,
      ),
    ).toEqual({
      up: 'DROP FUNCTION "add"("a" integer, "b" integer)',
      down: `CREATE FUNCTION "add"(\n  "a" integer,\n  "b" integer DEFAULT 0\n) ${addDefinition}`,
    })
  })

  it("throws for an out parameter with a default before it drops the function, whose rollback could not create it again", () => {
    expect(
      getThrownError(() =>
        dropFunction("f", { a: { mode: "out", type: "integer", default: "0" } }, addDefinition),
      ),
    ).toEqual(new Error("Invalid parameter a of function f: an out parameter takes no default"))
  })
})

describe("replaceFunction", () => {
  it("checks that the target schema has the function of the types of the parameters other than OUT, replaces its definition, and restores the previous definition", () => {
    const parameters = {
      first: "integer",
      rest: { mode: "variadic", type: "integer[]" },
      total: { mode: "out", type: "integer" },
    } as const

    expect(
      replaceFunction(
        "sum",
        parameters,
        "LANGUAGE sql IMMUTABLE RETURN first + rest[1]",
        "LANGUAGE sql IMMUTABLE RETURN first + (SELECT sum(x) FROM unnest(rest) AS x)",
      ),
    ).toEqual({
      up: `${checkSum}\n;\nCREATE OR REPLACE FUNCTION "sum"(\n  "first" integer,\n  VARIADIC "rest" integer[],\n  OUT "total" integer\n) LANGUAGE sql IMMUTABLE RETURN first + (SELECT sum(x) FROM unnest(rest) AS x)`,
      down: `${checkSum}\n;\nCREATE OR REPLACE FUNCTION "sum"(\n  "first" integer,\n  VARIADIC "rest" integer[],\n  OUT "total" integer\n) LANGUAGE sql IMMUTABLE RETURN first + rest[1]`,
    })
  })
})

describePostgres("function helpers in PostgreSQL", ({ database, testTransaction }) => {
  it("createFunction creates a function of parameters with modes and defaults, and its rollback drops it", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        createFunction(
          "enqueue",
          {
            task: "text",
            payload: { type: "jsonb", default: "null" },
            tags: { mode: "variadic", type: "text[]", default: "'{}'" },
            id: { mode: "out", type: "bigint" },
            created: { mode: "out", type: "boolean" },
          },
          "LANGUAGE sql BEGIN ATOMIC SELECT 1::bigint, true; END",
        ),
      ),
    )

    expect(result.up).toHaveLength(1)
    expect(result.up[0]).toStartWith(
      "function CREATE OR REPLACE FUNCTION migrations_helpers.enqueue(task text, payload jsonb DEFAULT NULL::jsonb, VARIADIC tags text[] DEFAULT '{}'::text[], OUT id bigint, OUT created boolean)",
    )
    expect(result.down).toEqual(result.before)
  })

  it("createFunction and replaceFunction keep a line comment of a type or a default from commenting out the SQL after it", async () => {
    const parameters = {
      rate: "numeric -- per unit",
      amount: { type: "numeric -- in cents", default: "0 -- none" },
    } as const
    const definition = "RETURNS numeric LANGUAGE sql RETURN amount * rate"
    const result = await testTransaction(() =>
      applyStep(
        database,
        combineSteps(
          createFunction("convert", parameters, definition),
          replaceFunction("convert", parameters, definition, definition),
        ),
      ),
    )

    expect(result.up).toEqual([
      expect.stringContaining("convert(rate numeric, amount numeric DEFAULT 0)"),
    ])
    expect(result.down).toEqual(result.before)
  })

  it("dropFunction drops the overload of its parameters, and its rollback creates it again", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        dropFunction("add", addParameters, addDefinition),
        `CREATE FUNCTION add(a integer, b integer) ${addDefinition}; CREATE FUNCTION add(a text, b text) RETURNS text LANGUAGE sql RETURN a || b`,
      ),
    )

    expect(result.up).toEqual([expect.stringContaining("add(a text, b text)")])
    expect(result.down).toEqual(result.before)
  })

  // node-pg-migrate rolls back createFunction with replace: true by dropping the function: https://github.com/salsita/node-pg-migrate/blob/v9.0.0/src/operations/functions/createFunction.ts#L92
  it("replaceFunction replaces the definition of a function keeping its grants, and its rollback restores the definition keeping them", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        replaceFunction(
          "add",
          addParameters,
          addDefinition,
          "RETURNS integer LANGUAGE sql IMMUTABLE RETURN b + a",
        ),
        `CREATE FUNCTION add(a integer, b integer) ${addDefinition}; REVOKE EXECUTE ON FUNCTION add(integer, integer) FROM PUBLIC`,
      ),
    )

    expect(result.up).toEqual([expect.stringMatching(/RETURN \(b \+ a\).* GRANT \{/s)])
    expect(result.down).toEqual(result.before)
  })

  it("replaceFunction fails for a function missing from the target schema rather than creating it", async () => {
    await testTransaction(async () => {
      const step = replaceFunction("add", addParameters, addDefinition, addDefinition)
      const otherOverload = `CREATE FUNCTION add(a text, b text) RETURNS text LANGUAGE sql RETURN a || b`

      await expect(applyStep(database, step, otherOverload)).rejects.toMatchObject({
        code: "42883",
      })
    })
  })

  it("replaceFunction fails for a function missing from the target schema that a later schema of the search path has", async () => {
    const laterSchema = "migrations_helpers_later"
    await testTransaction(async () => {
      const step = replaceFunction("add", addParameters, addDefinition, addDefinition)
      await database.script(
        `CREATE SCHEMA ${helperSchema}; CREATE SCHEMA ${laterSchema}; CREATE FUNCTION ${laterSchema}.add(a integer, b integer) ${addDefinition}`,
      )

      const replacing = database.transaction(() => runChange(database, step.up), {
        searchPath: createMigrationSearchPath(helperSchema, [laterSchema]),
      })

      await expect(replacing).rejects.toMatchObject({ code: "42883" })
    })
  })

  it("replaceFunction fails rollback for a function missing from the target schema rather than creating it", async () => {
    await testTransaction(async () => {
      const step = replaceFunction("add", addParameters, addDefinition, addDefinition)

      await expect(applyStep(database, invertStep(step))).rejects.toMatchObject({
        code: "42883",
      })
    })
  })

  it("verifyMigrations accepts a history that creates, replaces, and drops a function", async () => {
    const parameters = {
      a: "integer",
      b: { mode: "inout", type: "integer", default: "0" },
    } as const
    const history = defineMigrations({
      "0001_create_add": createFunction("add", parameters, "LANGUAGE sql RETURN a + b"),
      "0002_replace_add": replaceFunction(
        "add",
        parameters,
        "LANGUAGE sql RETURN a + b",
        "LANGUAGE sql RETURN b + a",
      ),
      "0003_drop_add": dropFunction("add", parameters, "LANGUAGE sql RETURN b + a"),
    })

    await testTransaction(() => verifyMigrations(database, history))
  })
})
