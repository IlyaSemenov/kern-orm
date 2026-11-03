// Time of executing a query through `db.$execute` against a driver that answers with prepared rows, as PostgreSQL returns them as text.
// It includes preparing the statement and routing it to the driver, as every execution does, besides decoding the rows into records.
// The scenarios decode wide records of scalars, and records with nested rows packed as JSON.

import assert from "node:assert/strict"

import type { DriverResult, TextValue } from "kern-orm"

import { createEvent, createFixture, createUuid } from "./fixture.ts"
import type { Topic } from "./scenario.ts"

const decoding: Topic = build => ({
  "1000 records of 10 columns": async () => {
    const rows: TextValue[][] = []
    for (let index = 0; index < 1000; index++) {
      rows.push(createEventRow(index))
    }
    const { db } = createFixture(build, createResult(eventColumns, rows))
    const query = db.event.select("*")
    const records = await db.$execute(query)
    assert.equal(records.length, 1000)
    // An event whose columns of one type hold different values, so that the check catches swapped columns.
    assert.deepEqual(records[10], {
      id: createUuid(10),
      accountId: 10,
      kind: "order",
      title: "Event 10",
      active: true,
      amount: "10.25",
      quantity: 3,
      createdAt: "2026-01-01T00:00:10.000000Z",
      payload: { index: 10, tags: ["benchmark"] },
      note: null,
    })
    return () => db.$execute(query)
  },
  "100 records with 10 nested records each": async () => {
    const rows: TextValue[][] = []
    for (let form = 0; form < 100; form++) {
      // A packed row holds the text of each value, as `format('%s')` gives it.
      const fields: TextValue[][] = []
      for (let position = 0; position < 10; position++) {
        fields.push([createUuid(form * 10 + position), String(position), `Field ${position}`])
      }
      rows.push([createUuid(form), `Form ${form}`, JSON.stringify(fields)])
    }
    const { db } = createFixture(build, createResult(["id", "name", "fields"], rows))
    const query = db.form.select("id", "name").select(form => ({
      fields: form.fields.orderBy("position").select("id", "position", "label"),
    }))
    const records = await db.$execute(query)
    assert.equal(records.length, 100)
    const record = records[1]!
    assert.equal(record.id, createUuid(1))
    assert.equal(record.name, "Form 1")
    assert.equal(record.fields.length, 10)
    assert.deepEqual(record.fields[2], { id: createUuid(12), position: 2, label: "Field 2" })
    return () => db.$execute(query)
  },
})

/** Result of a `SELECT` of `rows` with result `columns`. */
function createResult(columns: string[], rows: TextValue[][]): DriverResult {
  return { command: "SELECT", count: rows.length, columns, rows }
}

/** Columns of the table of events in their order, which name the result columns of `select("*")`. */
const eventColumns = [
  "id",
  "accountId",
  "kind",
  "title",
  "active",
  "amount",
  "quantity",
  "createdAt",
  "payload",
  "note",
]

/** Text representations of the values of event number `index` in the order of `eventColumns`, as PostgreSQL returns them. */
function createEventRow(index: number): TextValue[] {
  const event = createEvent(index)
  return [
    event.id,
    String(event.accountId),
    event.kind,
    event.title,
    event.active ? "t" : "f",
    event.amount,
    String(event.quantity),
    // Such as `2026-01-01 00:00:05+00` in the time zone UTC.
    `${event.createdAt.toISOString().slice(0, 19).replace("T", " ")}+00`,
    JSON.stringify(event.payload),
    event.note,
  ]
}

export default decoding
