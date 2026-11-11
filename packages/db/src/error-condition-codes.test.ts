import { expect, it } from "bun:test"

import { describePostgres } from "@kern-orm/test-harness/postgres"

import { conditionsByCode } from "./error-condition-codes"
import * as t from "./types"

// With the test in PostgreSQL, it checks the condition of every code: the condition of another class does not catch the code, and that of its own class names no other code.
it("uses each class condition name only for its class code", () => {
  const conditions: Readonly<Record<string, string>> = conditionsByCode
  const misnamed = Object.keys(conditions).filter(
    code => !code.endsWith("000") && conditions[code] === conditions[`${code.slice(0, 2)}000`],
  )

  expect(misnamed).toEqual([])
})

it("maps each shared condition name to both codes", () => {
  const codesByCondition: Record<string, string[]> = {}
  for (const [code, condition] of Object.entries(conditionsByCode)) {
    ;(codesByCondition[condition] ??= []).push(code)
  }

  expect(Object.entries(codesByCondition).filter(([, codes]) => codes.length > 1)).toEqual([
    ["null_value_not_allowed", ["22004", "39004"]],
    ["modifying_sql_data_not_permitted", ["38002", "2F002"]],
    ["prohibited_sql_statement_attempted", ["38003", "2F003"]],
    ["reading_sql_data_not_permitted", ["38004", "2F004"]],
  ])
})

describePostgres("in PostgreSQL", ({ database, testTransaction }) => {
  it("names each code by a condition that catches it in PL/pgSQL", async () => {
    // Each block raises a code and returns it unless the condition of the table catches it; the outer handler names `query_canceled` and `assert_failure`, which `OTHERS` leaves out.
    const blocks = Object.entries(conditionsByCode).map(
      ([code, condition]) => `
        BEGIN
          BEGIN
            RAISE SQLSTATE '${code}';
          EXCEPTION WHEN ${condition} THEN
            NULL;
          END;
        EXCEPTION WHEN query_canceled OR assert_failure OR OTHERS THEN
          RETURN NEXT '${code}';
        END;`,
    )

    const uncaught = await testTransaction(async () => {
      await database.script(`
        CREATE FUNCTION pg_temp.uncaught_codes() RETURNS SETOF text LANGUAGE plpgsql AS $$
        BEGIN${blocks.join("")}
        END $$
      `)
      return await database.query`SELECT pg_temp.uncaught_codes()`.pluck(t.text)
    })

    expect(uncaught).toEqual([])
  })
})
