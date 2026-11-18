// Schema and Db of the runtime benchmarks, and their deterministic data.
// - Forms with fields with answers, for filters and nested relations.
// - Events of 10 columns of several types, for wide records.

import type { Driver, DriverResult } from "kern-orm"
import { bindSchema, createDatabase, defineSchema, defineTable, many, one } from "kern-orm"
import * as t from "kern-orm/types"

/** Result without rows, which the driver of a fixture answers with by default. */
const noRows: DriverResult = { command: "SELECT", count: 0, columns: [], rows: [] }

/** Creates the tables, the schema, and a `Db` of them, whose driver answers every statement with `result`. */
export function createFixture(result: DriverResult = noRows) {
  const form = defineTable("form", {
    id: t.uuid.primaryKey(),
    name: t.text,
    published: t.boolean,
    position: t.integer,
  })
  const field = defineTable("field", {
    id: t.uuid.primaryKey(),
    formId: t.uuid,
    position: t.integer,
    label: t.text,
  })
  const answer = defineTable("answer", {
    id: t.uuid.primaryKey(),
    fieldId: t.uuid,
    value: t.text,
  })
  const event = defineTable("event", {
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
  const schema = defineSchema({ form, field, answer, event }).$relations({
    form: { fields: many(field, { from: "id", to: "formId" }) },
    field: {
      form: one(form, { from: "formId", to: "id", required: true }),
      answers: many(answer, { from: "id", to: "fieldId" }),
    },
  })
  const db = bindSchema(schema, createDatabase({ driver: createDriver(result) }))
  return { db }
}

/** Driver that answers every statement with `result` and rejects scripts and transactions. */
function createDriver(result: DriverResult): Driver {
  const reject = () =>
    Promise.reject(new Error("The driver of the runtime benchmarks only executes statements"))
  return {
    execute: () => Promise.resolve(result),
    executeScript: reject,
    acquire: reject,
    close: () => Promise.resolve(),
  }
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
