import { describe, expect, it } from "bun:test"

import type { Database } from "kern-db"
import * as t from "kern-db/types"

import { describePooledPostgres, describePostgres } from "../../testing/postgres"
import type { MigrationChange } from "../migration"
import { runChange } from "../migration"

import { createIndex, dropIndex } from "./indexes"
import { applyStep, describeHelperSchema, inHelperSession } from "./testing"

describe("createIndex", () => {
  it("creates an index of the name that PostgreSQL gives it, and drops it", () => {
    expect(createIndex("form_field", ["form_id", "position"])).toEqual({
      up: 'CREATE INDEX "form_field_form_id_position_idx" ON "form_field" (form_id, position)',
      down: 'DROP INDEX "form_field_form_id_position_idx"',
    })
  })

  it("creates an index with every option in the order of CREATE INDEX", () => {
    expect(
      createIndex("form_field", ["form_id", "position"], {
        unique: true,
        nullsNotDistinct: true,
        using: "btree",
        include: ["label"],
        where: "deleted_at IS NULL",
      }).up,
    ).toBe(
      'CREATE UNIQUE INDEX "form_field_form_id_position_label_idx" ON "form_field" USING btree (form_id, position) INCLUDE (label) NULLS NOT DISTINCT WHERE deleted_at IS NULL',
    )
  })

  it("names an index by its columns without their orderings, as PostgreSQL does", () => {
    expect(createIndex("form", ["created_at desc nulls last", "id DESC"]).up).toBe(
      'CREATE INDEX "form_created_at_id_idx" ON "form" (created_at desc nulls last, id DESC)',
    )
  })

  it("creates an index of expressions with its name", () => {
    expect(createIndex("form", ["lower(name)"], { name: "form_name_idx" })).toEqual({
      up: 'CREATE INDEX "form_name_idx" ON "form" (lower(name))',
      down: 'DROP INDEX "form_name_idx"',
    })
  })

  it("adds changes outside a transaction with concurrently, keeping up and down", () => {
    expect(createIndex("form_field", ["form_id"], { unique: true, concurrently: true })).toEqual({
      ...createIndex("form_field", ["form_id"], { unique: true }),
      outsideTransaction: { up: expect.any(Function), down: expect.any(Function) },
    })
  })

  it("requires a name for an element other than a column with an ordering, a quoted or repeated column, and a name longer than PostgreSQL keeps", () => {
    const reject = (columns: string[], include?: string[]) => {
      try {
        createIndex("form", columns, { include })
      } catch (error) {
        return (error as Error).message
      }
      return undefined
    }

    expect([
      reject(["(true)"]),
      reject(['id COLLATE "C"']),
      reject(["id\u00a0DESC"]),
      reject(["id de\u017fc"]),
      reject(['"Name"']),
      reject(["id"], ["label DESC"]),
      reject(["id", "id DESC"]),
      reject(["c".repeat(56)]),
    ]).toEqual([
      "Cannot name the index of table form on (true): (true) is not a lowercase column name with an optional ordering, so pass name",
      'Cannot name the index of table form on id COLLATE "C": id COLLATE "C" is not a lowercase column name with an optional ordering, so pass name',
      "Cannot name the index of table form on id\u00a0DESC: id\u00a0DESC is not a lowercase column name with an optional ordering, so pass name",
      "Cannot name the index of table form on id de\u017fc: id de\u017fc is not a lowercase column name with an optional ordering, so pass name",
      'Cannot name the index of table form on "Name": "Name" is not a lowercase column name with an optional ordering, so pass name',
      "Cannot name the index of table form on id, label DESC: label DESC is not a lowercase column name, so pass name",
      "Cannot name the index of table form on id, id DESC: column id repeats, so pass name",
      `Cannot name the index of table form on ${"c".repeat(56)}: form_${"c".repeat(56)}_idx is longer than 63 bytes, so pass a shorter name`,
    ])
  })

  it("rejects an index without columns", () => {
    expect(() => createIndex("form", [])).toThrow(
      "Cannot create an index of table form without columns",
    )
  })
})

describe("dropIndex", () => {
  it("drops an index of the name that createIndex gives it, and creates it again", () => {
    expect(dropIndex("form_field", ["form_id"], { where: "deleted_at IS NULL" })).toEqual({
      up: 'DROP INDEX "form_field_form_id_idx"',
      down: 'CREATE INDEX "form_field_form_id_idx" ON "form_field" (form_id) WHERE deleted_at IS NULL',
    })
  })

  it("adds changes outside a transaction with concurrently, keeping up and down", () => {
    expect(dropIndex("form_field", ["form_id"], { concurrently: true })).toEqual({
      ...dropIndex("form_field", ["form_id"]),
      outsideTransaction: { up: expect.any(Function), down: expect.any(Function) },
    })
  })
})

describePostgres("index helpers in PostgreSQL", ({ database, testTransaction }) => {
  const createFormField =
    "CREATE TABLE form_field (form_id integer, position integer, label text, deleted_at timestamptz)"

  it("createIndex creates an index of the name that PostgreSQL gives an index without a name, and its rollback drops it", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        createIndex("form_field", ["form_id", "position DESC"], {
          unique: true,
          include: ["label"],
          where: "deleted_at IS NULL",
        }),
        createFormField,
      ),
    )
    const named = await testTransaction(() =>
      applyStep(
        database,
        {
          up: "CREATE UNIQUE INDEX ON form_field (form_id, position DESC) INCLUDE (label) WHERE deleted_at IS NULL",
        },
        createFormField,
      ),
    )

    expect(result.up).toEqual(named.up)
    expect(result.up).toContain(
      'index CREATE UNIQUE INDEX form_field_form_id_position_label_idx ON migrations_helpers.form_field USING btree (form_id, "position" DESC) INCLUDE (label) WHERE (deleted_at IS NULL)',
    )
    expect(result.down).toEqual(result.before)
  })

  it("dropIndex drops an index, and its rollback creates it again", async () => {
    const result = await testTransaction(() =>
      applyStep(
        database,
        dropIndex("form_field", ["form_id"], { using: "hash" }),
        `${createFormField}; CREATE INDEX ON form_field USING hash (form_id)`,
      ),
    )

    expect(result.up).toEqual(result.before.filter(line => !line.startsWith("index ")))
    expect(result.down).toEqual(result.before)
  })
})

describePooledPostgres(
  "index helpers outside a transaction",
  ({ database, recordStatements, notices }) => {
    const createFormField =
      "CREATE TABLE form_field (form_id integer, position integer, label text, deleted_at timestamptz)"
    // Values that fail a unique index of `form_id`.
    const createDuplicates = `${createFormField}; INSERT INTO form_field (form_id, position) VALUES (1, 1), (1, 2)`

    /** Runs `change` and returns the statements of its changes to the schema, without its reads of the catalog. */
    async function recordChanges(change: MigrationChange): Promise<string[]> {
      const statements = await recordStatements(() => runChange(database, change))
      return statements.filter(text => !text.includes("pg_catalog.to_regclass("))
    }

    it("createIndex with concurrently builds the index that up builds, and its rollback drops it", async () => {
      const step = createIndex("form_field", ["form_id", "position DESC"], {
        unique: true,
        include: ["label"],
        where: "deleted_at IS NULL",
        concurrently: true,
      })

      const result = await inHelperSession(database, async () => {
        await database.script(createFormField)
        const before = await describeHelperSchema(database)
        await runChange(database, step.up)
        const inside = await describeHelperSchema(database)
        await runChange(database, step.down!)
        const created = await recordChanges(step.outsideTransaction!.up!)
        const outside = await describeHelperSchema(database)
        const dropped = await recordChanges(step.outsideTransaction!.down!)
        return {
          before,
          inside,
          outside,
          after: await describeHelperSchema(database),
          created,
          dropped,
        }
      })

      expect(result.outside).toEqual(result.inside)
      expect(result.after).toEqual(result.before)
      expect([result.created, result.dropped]).toEqual([
        [
          'CREATE UNIQUE INDEX CONCURRENTLY "form_field_form_id_position_label_idx" ON "form_field" (form_id, position DESC) INCLUDE (label) WHERE deleted_at IS NULL',
        ],
        ['DROP INDEX CONCURRENTLY "form_field_form_id_position_label_idx"'],
      ])
    })

    it("dropIndex with concurrently drops the index, and its rollback builds it again", async () => {
      const step = dropIndex("form_field", ["form_id"], { using: "hash", concurrently: true })

      const result = await inHelperSession(database, async () => {
        await database.script(`${createFormField}; CREATE INDEX ON form_field USING hash (form_id)`)
        const before = await describeHelperSchema(database)
        const dropped = await recordChanges(step.outsideTransaction!.up!)
        const up = await describeHelperSchema(database)
        const created = await recordChanges(step.outsideTransaction!.down!)
        return { before, up, down: await describeHelperSchema(database), dropped, created }
      })

      expect(result.up).toEqual(result.before.filter(line => !line.startsWith("index ")))
      expect(result.down).toEqual(result.before)
      expect([result.dropped, result.created]).toEqual([
        ['DROP INDEX CONCURRENTLY "form_field_form_id_idx"'],
        ['CREATE INDEX CONCURRENTLY "form_field_form_id_idx" ON "form_field" USING hash (form_id)'],
      ])
    })

    // Rails with `if_not_exists: true` passed on the index that a failed build left not valid: https://github.com/rails/rails/issues/52583
    it("createIndex with concurrently builds again the index that a failed build left not valid", async () => {
      const step = createIndex("form_field", ["form_id"], { unique: true, concurrently: true })

      const result = await inHelperSession(database, async () => {
        await database.script(createDuplicates)
        const failure = await runChange(database, step.outsideTransaction!.up!).catch(
          (error: unknown) => error,
        )
        const failed = await listValidity(database, "form_field_form_id_idx")
        await database.script("DELETE FROM form_field WHERE position = 2")
        const changes = await recordChanges(step.outsideTransaction!.up!)
        return {
          failure,
          failed,
          changes,
          built: await listValidity(database, "form_field_form_id_idx"),
        }
      })

      expect(result.failure).toMatchObject({ code: "23505" })
      expect(result.failed).toEqual([false])
      expect(result.changes).toEqual([
        'DROP INDEX CONCURRENTLY "form_field_form_id_idx"',
        'CREATE UNIQUE INDEX CONCURRENTLY "form_field_form_id_idx" ON "form_field" (form_id)',
      ])
      expect(result.built).toEqual([true])
    })

    it("createIndex with concurrently drops on rollback the index that a failed build left not valid", async () => {
      const step = createIndex("form_field", ["form_id"], { unique: true, concurrently: true })

      const result = await inHelperSession(database, async () => {
        await database.script(createDuplicates)
        await runChange(database, step.outsideTransaction!.up!).catch(() => {})
        const failed = await listValidity(database, "form_field_form_id_idx")
        const changes = [
          await recordChanges(step.outsideTransaction!.down!),
          await recordChanges(step.outsideTransaction!.down!),
        ]
        return { failed, changes, dropped: await listValidity(database, "form_field_form_id_idx") }
      })

      expect(result.failed).toEqual([false])
      expect(result.changes).toEqual([['DROP INDEX CONCURRENTLY "form_field_form_id_idx"'], []])
      expect(result.dropped).toEqual([])
    })

    it("createIndex with concurrently counts a valid index of its name as built, and its rollback does nothing without the index, sending no notices", async () => {
      const step = createIndex("form_field", ["form_id"], { concurrently: true })
      const noticesBefore = notices.length

      const changes = await inHelperSession(database, async () => {
        await database.script(createFormField)
        await runChange(database, step.outsideTransaction!.up!)
        return [
          await recordChanges(step.outsideTransaction!.up!),
          await recordChanges(step.outsideTransaction!.down!),
          await recordChanges(step.outsideTransaction!.down!),
        ]
      })

      expect(changes).toEqual([[], ['DROP INDEX CONCURRENTLY "form_field_form_id_idx"'], []])
      expect(notices.slice(noticesBefore)).toEqual([])
    })

    it("createIndex and dropIndex with concurrently reject a name that finds an index of another table, also in an earlier schema of the search path, changing nothing", async () => {
      const step = createIndex("form_field", ["form_id"], { concurrently: true })
      const message =
        "Index name form_field_form_id_idx finds a relation other than an index of table form_field through the search path"

      const result = await inHelperSession(database, async () => {
        // `DROP INDEX form_field_form_id_idx` finds the index of form, in the first schema of the search path.
        await database.script(`
            CREATE TABLE migrations_helpers_shared.form_field (form_id integer);
            CREATE TABLE form (id integer);
            CREATE INDEX form_field_form_id_idx ON form (id);
          `)
        const buildFailure = await runChange(database, step.outsideTransaction!.up!).catch(
          (error: unknown) => error,
        )
        const built = await listIndexTables(database)
        await database.script(
          "CREATE INDEX form_field_form_id_idx ON migrations_helpers_shared.form_field (form_id)",
        )
        const dropFailure = await runChange(database, step.outsideTransaction!.down!).catch(
          (error: unknown) => error,
        )
        return { buildFailure, built, dropFailure, dropped: await listIndexTables(database) }
      }, ["migrations_helpers_shared"])

      expect(result.buildFailure).toMatchObject({ message })
      expect(result.built).toEqual(["migrations_helpers.form"])
      expect(result.dropFailure).toMatchObject({ message })
      expect(result.dropped).toEqual([
        "migrations_helpers.form",
        "migrations_helpers_shared.form_field",
      ])
    })

    it("createIndex and dropIndex with concurrently reject a partitioned table without changing it", async () => {
      const createJob = `
        CREATE TABLE job (run_at timestamptz) PARTITION BY RANGE (run_at);
        CREATE TABLE job_2026 PARTITION OF job FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')
      `

      const result = await inHelperSession(database, async () => {
        await database.script(createJob)
        const before = await describeHelperSchema(database)
        const createFailure = await runChange(
          database,
          createIndex("job", ["run_at"], { concurrently: true }).outsideTransaction!.up!,
        ).catch((error: unknown) => error)
        const created = await describeHelperSchema(database)
        await database.script("CREATE INDEX ON job (run_at)")
        const indexed = await describeHelperSchema(database)
        const dropFailure = await runChange(
          database,
          dropIndex("job", ["run_at"], { concurrently: true }).outsideTransaction!.up!,
        ).catch((error: unknown) => error)
        const dropped = await describeHelperSchema(database)
        return { before, createFailure, created, indexed, dropFailure, dropped }
      })

      expect(result.createFailure).toMatchObject({
        message: 'cannot create index on partitioned table "job" concurrently',
      })
      expect(result.created).toEqual(result.before)
      expect(result.dropFailure).toMatchObject({
        message: 'cannot drop partitioned index "job_run_at_idx" concurrently',
      })
      expect(result.dropped).toEqual(result.indexed)
    })
  },
)

/** Lists the tables of the indexes named `form_field_form_id_idx`, qualified with their schemas. */
async function listIndexTables(database: Database): Promise<string[]> {
  return await database.query`
    SELECT schemaname || '.' || tablename FROM pg_indexes
    WHERE indexname = 'form_field_form_id_idx' ORDER BY 1
  `.pluck(t.text)
}

/** Lists whether each index of `name` in schema `migrations_helpers` is valid. */
async function listValidity(database: Database, name: string): Promise<boolean[]> {
  return await database.query`
    SELECT indisvalid FROM pg_index JOIN pg_class ON pg_class.oid = indexrelid
    WHERE relname = ${name} AND relnamespace = 'migrations_helpers'::regnamespace
  `.pluck(t.boolean)
}
