import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { isQueryError, NotFoundError } from "kern-db"

import {
  describePooledPostgres,
  startsWaiting,
  startWaiting,
  whileHolding,
} from "../../testing/postgres"
import { bindSchema } from "../execution/db"
import { RequiredRelationError } from "../result/result"
import { many, one } from "../schema/relation"
import { defineSchema } from "../schema/schema"
import { defineTable } from "../table/table"
import * as t from "../types"

import type { AnySelectQuery } from "./select"

const form = defineTable("form", {
  id: t.integer.primaryKey(),
  published: t.boolean,
})

const field = defineTable("form_field", {
  id: t.integer.primaryKey(),
  formId: t.integer.columnName("form_id"),
  position: t.integer,
})

const schema = defineSchema({ form, field }).$relations({
  form: {
    fields: many(field, { from: "id", to: "formId" }),
  },
  field: {
    form: one(form, { from: "formId", to: "id", required: true }),
  },
})

describe("the clause of a query", () => {
  const forms = schema.form.select("id")
  const text = 'SELECT "form"."id" AS "id" FROM "form" AS "form"'

  it("names the strength of each method", () => {
    expect(forms.forUpdate().toSQL().text).toBe(`${text} FOR UPDATE`)
    expect(forms.forNoKeyUpdate().toSQL().text).toBe(`${text} FOR NO KEY UPDATE`)
    expect(forms.forShare().toSQL().text).toBe(`${text} FOR SHARE`)
    expect(forms.forKeyShare().toSQL().text).toBe(`${text} FOR KEY SHARE`)
  })

  it("tells what to do with a locked row, in each method", () => {
    expect(forms.forUpdate({ noWait: true }).toSQL().text).toBe(`${text} FOR UPDATE NOWAIT`)
    expect(forms.forUpdate({ skipLocked: true }).toSQL().text).toBe(
      `${text} FOR UPDATE SKIP LOCKED`,
    )
    expect(forms.forNoKeyUpdate({ skipLocked: true }).toSQL().text).toBe(
      `${text} FOR NO KEY UPDATE SKIP LOCKED`,
    )
    expect(forms.forShare({ noWait: true }).toSQL().text).toBe(`${text} FOR SHARE NOWAIT`)
    expect(forms.forKeyShare({ noWait: true }).toSQL().text).toBe(`${text} FOR KEY SHARE NOWAIT`)
    expect(forms.forUpdate({ noWait: false, skipLocked: false }).toSQL().text).toBe(
      `${text} FOR UPDATE`,
    )
  })

  it("rejects both options, which contradict each other", () => {
    expect(() => forms.forUpdate({ noWait: true, skipLocked: true } as never)).toThrow(
      "forUpdate takes either noWait or skipLocked, not both",
    )
  })

  it("replaces an earlier lock and leaves the query it derives from unchanged", () => {
    const shared = forms.forShare()

    expect(shared.forUpdate().toSQL().text).toBe(`${text} FOR UPDATE`)
    expect(shared.toSQL().text).toBe(`${text} FOR SHARE`)
    expect(forms.toSQL().text).toBe(text)
  })

  it("stays through the methods after it, whichever order they come in", () => {
    const expected = {
      text: 'SELECT "form"."id" AS "id" FROM "form" AS "form" WHERE "form"."published" = $1 ORDER BY 1 LIMIT 1 FOR UPDATE',
      parameters: ["t"],
    }

    expect(
      schema.form.where({ published: true }).orderBy("id").take().get("id").forUpdate().toSQL(),
    ).toEqual(expected)
    expect(
      schema.form.forUpdate().get("id").take().orderBy("id").where({ published: true }).toSQL(),
    ).toEqual(expected)
  })

  it("comes after the limit and the offset, and locks without fields", () => {
    expect(schema.form.limit(1).offset(2).forUpdate().toSQL().text).toBe(
      'SELECT FROM "form" AS "form" LIMIT $1 OFFSET $2 FOR UPDATE',
    )
  })

  it("applies after map, which keeps the rows of the query", () => {
    expect(
      forms
        .map(({ id }) => id)
        .forUpdate()
        .toSQL().text,
    ).toBe(`${text} FOR UPDATE`)
  })

  it("rejects a query that returns no rows of its table, in either order", () => {
    // Types reject these calls, which a query held as any query can still make.
    const queries: [AnySelectQuery, string][] = [
      [schema.form.count(), "forUpdate cannot be used after an aggregate"],
      [schema.form.max("id"), "forUpdate cannot be used after an aggregate"],
      [schema.form.exists(), "forUpdate cannot be used after exists"],
      [
        forms.distinct(),
        "forUpdate cannot be used after distinct, since a row without duplicates comes from several rows of the table",
      ],
      [
        forms.distinctOn("published"),
        "forUpdate cannot be used after distinctOn; PostgreSQL does not allow row locks with DISTINCT ON",
      ],
      [
        forms.groupBy("id"),
        "forUpdate cannot be used after groupBy, since a group comes from several rows of the table",
      ],
    ]
    for (const [query, message] of queries) {
      expect(() => query.forUpdate()).toThrow(message)
    }

    const locked = forms.forUpdate()
    const rejection = (method: string) =>
      `${method} cannot be used after a row lock, since it returns no rows of the table to lock`
    expect(() => locked.count()).toThrow(rejection("count"))
    expect(() => locked.countDistinct("id")).toThrow(rejection("countDistinct"))
    expect(() => locked.max("id")).toThrow(rejection("max"))
    expect(() => locked.exists()).toThrow(rejection("exists"))
    expect(() => locked.distinct()).toThrow(
      "distinct cannot be used after a row lock, since a row without duplicates comes from several rows of the table",
    )
    expect(() => locked.distinctOn("published")).toThrow(
      "distinctOn cannot be used after a row lock; PostgreSQL does not allow row locks with DISTINCT ON",
    )
    expect(() => locked.groupBy("id")).toThrow(
      "groupBy cannot be used after a row lock, since a group comes from several rows of the table",
    )
  })
})

describe("the clause of a nested query", () => {
  it("stays in the query it is called on, apart from the query of its parent", () => {
    const parent = schema.field.select(field => ({
      form: field.form.select("id"),
    }))
    const { text: parentText } = parent.forUpdate().toSQL()
    expect(parentText).toEndWith('FROM "form_field" AS "form_field" FOR UPDATE')
    expect(parentText.match(/FOR UPDATE/g)).toHaveLength(1)

    const { text: nestedText } = schema.field
      .select(field => ({
        form: field.form.select("id").forShare(),
      }))
      .toSQL()
    expect(nestedText).toContain(
      'WHERE "form"."id" = "form_field"."form_id" FOR SHARE) AS "subquery"',
    )
    expect(nestedText).toEndWith('FROM "form_field" AS "form_field"')
  })

  it("locks each query by its own strength", () => {
    const { text } = schema.field
      .select(field => ({
        form: field.form.get("id").forShare({ noWait: true }),
      }))
      .forUpdate({ skipLocked: true })
      .toSQL()

    expect(text).toContain('FOR SHARE NOWAIT) AS "subquery"')
    expect(text).toEndWith('FROM "form_field" AS "form_field" FOR UPDATE SKIP LOCKED')
  })
})

// Testing conflicts between transactions requires separate connections, which see only committed rows, so these tests commit them in a PostgreSQL schema of their own, which each test drops.
describePooledPostgres("in PostgreSQL", ({ database }) => {
  const db = bindSchema(schema, database, { schemaName: "row_lock_test" })

  // The lock timeout fails a test that a transaction left open rather than hanging the others.
  beforeEach(() =>
    database.script(`
      SET LOCAL client_min_messages = warning;
      SET LOCAL lock_timeout = '5s';
      DROP SCHEMA IF EXISTS row_lock_test CASCADE;
      CREATE SCHEMA row_lock_test;
      CREATE TABLE row_lock_test.form (id integer PRIMARY KEY, published boolean NOT NULL);
      CREATE TABLE row_lock_test.form_field (
        id integer PRIMARY KEY,
        form_id integer NOT NULL REFERENCES row_lock_test.form,
        position integer NOT NULL
      );
      INSERT INTO row_lock_test.form VALUES (1, true), (2, true);
      INSERT INTO row_lock_test.form_field VALUES (1, 1, 1), (2, 1, 2), (3, 2, 1);
    `),
  )
  afterEach(() =>
    database.script(`
      SET LOCAL client_min_messages = warning;
      SET LOCAL lock_timeout = '5s';
      DROP SCHEMA row_lock_test CASCADE;
    `),
  )

  /** Tells whether another transaction holds a lock of the rows of `query` that conflicts with `forUpdate`, without waiting for it. */
  async function isLocked(query: AnySelectQuery): Promise<boolean> {
    try {
      await db.$transaction(() => db.$execute(query.forUpdate({ noWait: true })))
      return false
    } catch (error) {
      if (isQueryError(error, "lock_not_available")) {
        return true
      }
      throw error
    }
  }

  // Orchid ORM 1.78.37 selects a relation with LEFT JOIN LATERAL, so its forUpdate() of such a query fails with "FOR UPDATE cannot be applied to the nullable side of an outer join", and it must name the table: forUpdate(["idea"]).
  it("locks only the row of the query, whatever related records it selects", async () => {
    await whileHolding(
      db,
      () =>
        db.field
          .find(1)
          .select(field => ({
            form: field.form.select("id"),
            siblings: db.field.where({ formId: field.formId }).count(),
          }))
          .forUpdate(),
      async selected => {
        expect(selected).toEqual({ form: { id: 1 }, siblings: 2 })
        expect(await isLocked(db.field.find(1))).toBe(true)
        expect(await isLocked(db.form.find(1))).toBe(false)
        expect(await isLocked(db.field.find(2))).toBe(false)
      },
    )
  })

  it("locks a related record that the query of its parent does not lock", async () => {
    await whileHolding(
      db,
      () =>
        db.field.find(1).select(field => ({
          lockedFormId: field.form.where({ published: true }).get("id").forUpdate(),
        })),
      async selected => {
        expect(selected).toEqual({ lockedFormId: 1 })
        expect(await isLocked(db.form.find(1))).toBe(true)
        expect(await isLocked(db.field.find(1))).toBe(false)
      },
    )
  })

  it("locks all the rows of a nested query of many rows", async () => {
    await whileHolding(
      db,
      () =>
        db.form.find(1).select(form => ({
          fieldIds: form.fields.orderBy({ id: "desc" }).pluck("id").forUpdate(),
        })),
      async selected => {
        expect(selected).toEqual({ fieldIds: [2, 1] })
        expect(await isLocked(db.field.find(1))).toBe(true)
        expect(await isLocked(db.field.find(2))).toBe(true)
        expect(await isLocked(db.field.find(3))).toBe(false)
      },
    )
  })

  it("takes the locks of a nested query of many rows in its order, whichever order a scan reads its rows in", async () => {
    await whileHolding(
      db,
      () => db.field.find(1).forUpdate(),
      async (_held, commit) => {
        const { result } = await startWaiting(db, () =>
          db.form.find(1).select(form => ({
            fieldIds: form.fields.orderBy({ id: "desc" }).pluck("id").forUpdate(),
          })),
        )

        // It waits for the last row of its order, having locked the row before it.
        expect(await isLocked(db.field.find(2))).toBe(true)
        await commit()
        expect(await result).toEqual({ fieldIds: [2, 1] })
      },
    )
  })

  it("locks the rows of a sorted query and their related records", async () => {
    await whileHolding(
      db,
      () =>
        db.field
          .where(field => field.id.in([1, 3]))
          .orderBy({ formId: "desc" }, "id")
          .select("id")
          .select(field => ({
            lockedFormId: field.form.get("id").forUpdate(),
          }))
          .forUpdate(),
      async selected => {
        expect(selected).toEqual([
          { id: 3, lockedFormId: 2 },
          { id: 1, lockedFormId: 1 },
        ])
        expect(await isLocked(db.field.find(1))).toBe(true)
        expect(await isLocked(db.field.find(3))).toBe(true)
        expect(await isLocked(db.form.find(1))).toBe(true)
        expect(await isLocked(db.form.find(2))).toBe(true)
        expect(await isLocked(db.field.find(2))).toBe(false)
      },
    )
  })

  it("locks a row without selecting a field, and rejects without the row", async () => {
    await whileHolding(
      db,
      () => db.form.find(1).forUpdate(),
      async selected => {
        expect(selected).toEqual({})
        expect(await isLocked(db.form.find(1))).toBe(true)
      },
    )
    await expect(
      db.$transaction(async () => await db.form.find(3).forUpdate()),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("locks the rows of a page, of the rows it skips too, as PostgreSQL does", async () => {
    await whileHolding(
      db,
      () => db.form.orderBy("id").limit(1).offset(1).pluck("id").forUpdate(),
      async ids => {
        expect(ids).toEqual([2])
        expect(await isLocked(db.form.find(1))).toBe(true)
        expect(await isLocked(db.form.find(2))).toBe(true)
      },
    )
  })

  it("releases the lock of a nested transaction that rolls back", async () => {
    await whileHolding(
      db,
      () =>
        db.$transaction(async () => {
          await db.form.find(1).forUpdate()
          await expect(
            db.$transaction(async () => {
              await db.form.find(2).forUpdate()
              throw new Error("Rolled back")
            }),
          ).rejects.toThrow("Rolled back")
        }),
      async () => {
        expect(await isLocked(db.form.find(1))).toBe(true)
        expect(await isLocked(db.form.find(2))).toBe(false)
      },
    )
  })

  it("locks a related record before the row of its parent, which stays free while it waits", async () => {
    await whileHolding(
      db,
      () => db.form.find(1).forUpdate(),
      async (_held, commit) => {
        const { result } = await startWaiting(db, () =>
          db.field
            .find(1)
            .select(field => ({
              form: field.form.get("id").forUpdate(),
            }))
            .forUpdate(),
        )

        expect(await isLocked(db.field.find(1))).toBe(false)
        await commit()
        expect(await result).toEqual({ form: 1 })
      },
    )
  })

  // Orchid ORM 1.78.37 selects a relation with LEFT JOIN LATERAL, whose row PostgreSQL 18 does not read again after the wait: its query gives and locks only the related record of the old row.
  it("reads and locks the related record of the row that another transaction moves while it waits, after locking the row, and keeps the lock of the old record", async () => {
    await whileHolding(
      db,
      () => db.field.find(1).update({ formId: 2 }),
      async (_held, commitMove) => {
        const selectField = () =>
          db.field
            .find(1)
            .select("formId")
            .select(field => ({
              lockedFormId: field.form.get("id").forUpdate(),
            }))
            .forUpdate()

        // It keeps the foreign key of the move, which holds `FOR KEY SHARE` of the new form, from waiting.
        await whileHolding(
          db,
          () => db.form.find(2).forNoKeyUpdate(),
          async (_form, commitForm) => {
            const { pid, result } = await startWaiting(db, selectField)
            expect(await isLocked(db.form.find(1))).toBe(true)

            // The move no longer holds the query, which now waits for the new form with the row locked.
            await commitMove()
            expect(await startsWaiting(db, pid)).toBe(true)
            expect(await isLocked(db.field.find(1))).toBe(true)

            await commitForm()
            expect(await result).toEqual({ formId: 2, lockedFormId: 2 })
          },
        )
      },
    )
  })

  it("does not find a related record created after its statement started, which it reads again after the wait", async () => {
    await whileHolding(
      db,
      async () => {
        await db.form.insert({
          id: 3,
          published: true,
        })
        await db.field.find(1).update({ formId: 3 })
      },
      async (_held, commit) => {
        const { result } = await startWaiting(db, () =>
          db.field
            .find(1)
            .select(field => ({
              lockedFormId: field.form.get("id").forUpdate(),
            }))
            .forUpdate(),
        )
        await commit()

        await expect(result).rejects.toBeInstanceOf(RequiredRelationError)
      },
    )
  })

  it("checks a filter of a related record against the row that another transaction commits while it waits", async () => {
    await whileHolding(
      db,
      () => db.form.find(1).update({ published: false }),
      async (_held, commit) => {
        const { result } = await startWaiting(db, () =>
          db.field.find(1).select(field => ({
            publishedFormId: field.form.where({ published: true }).get("id").forShare(),
          })),
        )
        await commit()

        expect(await result).toEqual({ publishedFormId: undefined })
      },
    )
  })

  it("takes the next free row with skipLocked, and rejects a locked one with noWait", async () => {
    await whileHolding(
      db,
      () => db.field.find(1).forUpdate(),
      async () => {
        await db.$transaction(async () => {
          const next = await db.field
            .orderBy("id")
            .take()
            .select("id")
            .forUpdate({ skipLocked: true })

          expect(next).toEqual({ id: 2 })
        })

        // Orchid ORM 1.78.47 compiles noWait() to NO WAIT, which PostgreSQL 18 rejects as a syntax error.
        await expect(
          db.$transaction(async () => await db.field.find(1).forUpdate({ noWait: true })),
        ).rejects.toMatchObject({ code: "55P03" })
      },
    )
  })

  it("locks the related record of a row that skipLocked leaves out, since a nested query runs before the lock of the row", async () => {
    await whileHolding(
      db,
      () => db.field.find(3).forUpdate(),
      async () => {
        await whileHolding(
          db,
          () =>
            db.field
              .orderBy({ formId: "desc" }, "id")
              .take()
              .select("id")
              .select(field => ({
                lockedFormId: field.form.get("id").forUpdate(),
              }))
              .forUpdate({ skipLocked: true }),
          async next => {
            expect(next).toEqual({ id: 1, lockedFormId: 1 })
            expect(await isLocked(db.form.find(1))).toBe(true)
            // The form of the field that it left out.
            expect(await isLocked(db.form.find(2))).toBe(true)
            expect(await isLocked(db.field.find(2))).toBe(false)
          },
        )
      },
    )
  })

  it("takes the next free row in one statement of a mutation, outside a transaction", async () => {
    await whileHolding(
      db,
      () => db.field.find(1).forUpdate(),
      async () => {
        const taken = await db.field
          .where(field =>
            field.id.in(
              db.field.orderBy("id").limit(1).pluck("id").forUpdate({ skipLocked: true }),
            ),
          )
          .update({ position: 100 })
          .pluck("id")

        expect(taken).toEqual([2])
      },
    )
  })

  it("locks the record that a value of an insert or an update reads", async () => {
    await whileHolding(
      db,
      async () => {
        await db.field.insert({
          id: 4,
          formId: db.form.find(1).get("id").forUpdate(),
          position: 1,
        })
        await db.field.find(3).update({
          formId: db.form.find(2).get("id").forNoKeyUpdate(),
        })
      },
      async () => {
        expect(await isLocked(db.form.find(1))).toBe(true)
        expect(await isLocked(db.form.find(2))).toBe(true)
      },
    )
  })

  it("shows what the lock waited for only to the next statement, since one statement reads one snapshot", async () => {
    await whileHolding(
      db,
      async () => {
        await db.form.find(1).forUpdate()
        await db.field.insert({
          id: 4,
          formId: 1,
          position: 9,
        })
      },
      async (_held, commit) => {
        const { result } = await startWaiting(db, async () => {
          const inserted = await db.field
            .insert({
              id: 5,
              formId: db.form.find(1).get("id").forUpdate(),
              position: db.field.where({ formId: 1 }).max("position").coalesce(0),
            })
            .get("position")
          return { inserted, next: await db.field.where({ formId: 1 }).max("position") }
        })
        await commit()

        expect(await result).toEqual({ inserted: 2, next: 9 })
      },
    )
  })
})
