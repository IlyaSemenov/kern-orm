// Schema and Db of the runtime benchmarks over a build of kern-orm, and their deterministic data.
// - Forms with fields with answers, for filters and nested relations.
// - Events of 10 columns of several types, for wide records.

import type { Driver } from "kern-orm"

import type { Build } from "./scenario.ts"

/** Creates the tables, the schema, and a `Db` of them with the modules of `build`; the `Db` cannot execute statements. */
export function createFixture({ orm, types: t }: Build) {
  const form = orm.defineTable("form", {
    id: t.uuid.primaryKey(),
    name: t.text,
    published: t.boolean,
    position: t.integer,
  })
  const field = orm.defineTable("field", {
    id: t.uuid.primaryKey(),
    formId: t.uuid,
    position: t.integer,
    label: t.text,
  })
  const answer = orm.defineTable("answer", {
    id: t.uuid.primaryKey(),
    fieldId: t.uuid,
    value: t.text,
  })
  const event = orm.defineTable("event", {
    id: t.uuid.primaryKey(),
    accountId: t.integer,
    kind: t.text,
    title: t.text,
    active: t.boolean,
    amount: t.numeric,
    quantity: t.integer,
    createdAt: t.timestamptz,
    payload: t.jsonb,
    note: t.text.nullable(),
  })
  const schema = orm.defineSchema({ form, field, answer, event }).$relations({
    form: { fields: orm.many(field, { from: "id", to: "formId" }) },
    field: {
      form: orm.one(form, { from: "formId", to: "id", required: true }),
      answers: orm.many(answer, { from: "id", to: "fieldId" }),
    },
  })
  const db = orm.createDatabase({ driver: {} as Driver }).bind(schema)
  return { db }
}

/** UUID of number `index`, distinct for every index. */
export function createUuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`
}

/** Values of the columns of event number `index`. */
export function createEvent(index: number) {
  return {
    id: createUuid(index),
    accountId: index % 100,
    kind: index % 2 === 0 ? "order" : "refund",
    title: `Event ${index}`,
    active: index % 3 !== 0,
    amount: `${index}.25`,
    quantity: index % 7,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
    payload: { index, tags: ["benchmark"] },
    note: index % 5 === 0 ? null : `Note ${index}`,
  }
}
