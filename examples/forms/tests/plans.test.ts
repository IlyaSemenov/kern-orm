import { expect, it } from "bun:test"

import type { AnySelectQuery } from "kern-orm"
import { createStatement } from "kern-orm"

import { formActivity } from "../src/queries"
import { createTenantTables, describePostgres } from "../testing/postgres"

const fieldsPerForm = 10
const submissionsPerForm = 5
/** Forms of a page of `formActivity`. */
const pageSize = 20
/** Latest submissions of each form that `formActivity` selects. */
const latestSubmissions = 3

/**
 * Script that creates a tenant in PostgreSQL schema `schemaName` with `forms` generated forms and analyzes its tables.
 *
 * Form `n` takes its place by name in every tenant and keeps its fields, submissions, and comments, so that the first pages of two tenants are the same.
 * Every fourth form is unpublished, and every third field is shown after the previous one.
 * Each submission has its own user, who comments on its first answer and on the whole submission, and an answer to every field; every second submission is reviewed by the user of the previous one.
 * With `default_statistics_target` of 100, ANALYZE reads every row of a table of at most 30000 rows instead of a random sample, so the statistics are the same on every run.
 */
function createGeneratedTenant(schemaName: string, forms: number): string {
  const s = schemaName
  return `
    ${createTenantTables(s)}
    INSERT INTO ${s}."user" SELECT md5('user' || u)::uuid, 'user' || u || '@example.com' FROM generate_series(1, ${forms * submissionsPerForm}) AS u;
    INSERT INTO ${s}.form SELECT md5('form' || f)::uuid, 'Form ' || lpad(f::text, 4, '0'), f % 4 <> 0 FROM generate_series(1, ${forms}) AS f;
    INSERT INTO ${s}.form_field
      SELECT md5('field' || f || ':' || p)::uuid, md5('form' || f)::uuid, p, 'Field ' || p, CASE WHEN p % 3 = 0 THEN md5('field' || f || ':' || (p - 1))::uuid END
      FROM generate_series(1, ${forms}) AS f, generate_series(1, ${fieldsPerForm}) AS p;
    INSERT INTO ${s}.form_submission
      SELECT md5('submission' || f || ':' || n)::uuid, md5('form' || f)::uuid, md5('user' || (f - 1) * ${submissionsPerForm} + n)::uuid,
        CASE WHEN n % 2 = 0 THEN md5('user' || (f - 1) * ${submissionsPerForm} + n - 1)::uuid END, timestamptz '2026-01-01' + (f * ${submissionsPerForm} + n) * interval '1 hour'
      FROM generate_series(1, ${forms}) AS f, generate_series(1, ${submissionsPerForm}) AS n;
    INSERT INTO ${s}.form_answer
      SELECT md5('answer' || f || ':' || n || ':' || p)::uuid, md5('submission' || f || ':' || n)::uuid, md5('field' || f || ':' || p)::uuid, 'Value ' || p
      FROM generate_series(1, ${forms}) AS f, generate_series(1, ${submissionsPerForm}) AS n, generate_series(1, ${fieldsPerForm}) AS p;
    INSERT INTO ${s}.form_comment
      SELECT md5('comment' || f || ':' || n || ':' || c)::uuid, md5('submission' || f || ':' || n)::uuid, CASE WHEN c = 1 THEN md5('field' || f || ':1')::uuid END,
        md5('user' || (f - 1) * ${submissionsPerForm} + n)::uuid, 'Comment ' || c, timestamptz '2026-01-01' + (f * ${submissionsPerForm} + n) * interval '1 hour' + c * interval '1 minute'
      FROM generate_series(1, ${forms}) AS f, generate_series(1, ${submissionsPerForm}) AS n, generate_series(1, 2) AS c;
    ANALYZE ${s}.form, ${s}.form_field, ${s}."user", ${s}.form_submission, ${s}.form_answer, ${s}.form_comment;
  `
}

/** Node of a plan of `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` with the properties that the tests read. */
interface PlanNode {
  readonly "Node Type": string
  readonly "Parent Relationship"?: string
  readonly "Relation Name"?: string
  readonly "Actual Rows": number
  readonly "Actual Loops": number
  readonly "Rows Removed by Filter"?: number
  readonly "Rows Removed by Index Recheck"?: number
  readonly "Shared Hit Blocks": number
  readonly "Shared Read Blocks": number
  readonly Plans?: readonly PlanNode[]
}

/** What the execution of a statement processed, read from its plan without depending on the shape of the plan. */
interface PlanSummary {
  /** Tables read by a sequential scan. */
  readonly sequentialScans: readonly string[]
  /** Rows that the scans of each table read, including those that their conditions removed, recovered approximately from the numbers of each loop. */
  readonly rowsRead: Readonly<Record<string, number>>
  /** Number of runs of each subquery of the statement itself, apart from the subqueries nested in them. */
  readonly subqueryRuns: readonly number[]
  /** Shared buffer blocks that the statement read or found in the cache. */
  readonly blocks: number
}

function summarizePlan(plan: PlanNode): PlanSummary {
  const sequentialScans: string[] = []
  const rowsRead: Record<string, number> = {}
  const subqueryRuns: number[] = []
  const visit = (node: PlanNode, inSubquery: boolean) => {
    if (node["Node Type"] === "Seq Scan") {
      sequentialScans.push(node["Relation Name"]!)
    }
    const subquery = node["Parent Relationship"] === "SubPlan"
    if (subquery && !inSubquery) {
      subqueryRuns.push(node["Actual Loops"])
    }
    const table = node["Relation Name"]
    if (table !== undefined) {
      const rows =
        node["Actual Rows"] +
        (node["Rows Removed by Filter"] ?? 0) +
        (node["Rows Removed by Index Recheck"] ?? 0)
      // PostgreSQL reports the average rows of a loop rounded to two decimals, and the rows removed in a loop rounded to an integer.
      rowsRead[table] = Math.round((rowsRead[table] ?? 0) + rows * node["Actual Loops"])
    }
    for (const child of node.Plans ?? []) {
      visit(child, inSubquery || subquery)
    }
  }
  visit(plan, false)
  return {
    sequentialScans,
    rowsRead,
    subqueryRuns,
    blocks: plan["Shared Hit Blocks"] + plan["Shared Read Blocks"],
  }
}

describePostgres(
  "query plans in PostgreSQL",
  ({ database, tenantDb, testTransaction, useTestFixture, inTenant }) => {
    /** Executes `query` with `EXPLAIN ANALYZE` through the tenant `Db` in PostgreSQL schema `schemaName` and returns the summary of its plan. */
    function explain(schemaName: string, query: AnySelectQuery): Promise<PlanSummary> {
      return inTenant(schemaName, async () => {
        const { text, parameters } = tenantDb.$compile(query)
        const { rows } = await database.execute(
          createStatement(
            `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) ${text}`,
            parameters,
          ),
        )
        return summarizePlan(JSON.parse(rows[0]![0]!)[0].Plan)
      })
    }

    // Every table of the large tenant has 3 times the rows of the small one, at most 15000.
    useTestFixture(() =>
      database.script(
        createGeneratedTenant("tenant_small", 100) + createGeneratedTenant("tenant_large", 300),
      ),
    )

    it("read the nested records of a page of forms only for its forms, through indexes, whatever the number of forms", async () => {
      const page = formActivity.limit(pageSize)

      const { small, large, smallPage, largePage } = await testTransaction(async () => ({
        small: await explain("tenant_small", page),
        large: await explain("tenant_large", page),
        smallPage: await inTenant("tenant_small", async () => await tenantDb.$execute(page)),
        largePage: await inTenant("tenant_large", async () => await tenantDb.$execute(page)),
      }))

      expect(largePage).toEqual(smallPage)
      expect(small.sequentialScans).toEqual([])
      expect(large.sequentialScans).toEqual([])
      // Each nested query of a form runs once for each form of the page.
      expect(small.subqueryRuns).toEqual([pageSize, pageSize, pageSize])
      // The submissions of each form are read once to count them and once more up to the limit of the latest ones.
      expect(small.rowsRead["form_submission"]).toBe(
        pageSize * (submissionsPerForm + latestSubmissions),
      )
      expect(small.rowsRead["form_answer"]).toBe(pageSize * latestSubmissions * fieldsPerForm)
      expect(large.rowsRead).toEqual(small.rowsRead)
      // The blocks grow far less than the tables, which take 3 times more: a deeper B-tree index of the large tenant takes one more block for each lookup.
      expect(large.blocks).toBeLessThan(small.blocks * 1.5)
    })

    it("read the nested records of a page after an offset only for its forms, not for the forms that the offset skips", async () => {
      const later = await testTransaction(() =>
        explain("tenant_large", formActivity.limit(pageSize).offset(pageSize)),
      )

      expect(later.sequentialScans).toEqual([])
      expect(later.subqueryRuns).toEqual([pageSize, pageSize, pageSize])
      expect(later.rowsRead["form_submission"]).toBe(
        pageSize * (submissionsPerForm + latestSubmissions),
      )
      expect(later.rowsRead["form_answer"]).toBe(pageSize * latestSubmissions * fieldsPerForm)
    })
  },
)
