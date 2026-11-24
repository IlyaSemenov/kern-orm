// Time of executing a query, of the ORM through `db.$execute` or of SQL text, against a driver that answers with prepared rows, as PostgreSQL returns them as text.
// It includes preparing the statement and routing it to the driver, as every execution does, besides decoding the rows into records.
// The scenarios decode wide records of scalars, records of columns of one type, which tell the cost of its decoder, and records with nested rows packed as JSON.

import assert from "node:assert/strict"

import type { AnyType, DriverResult, TextValue } from "kern-orm"
import * as t from "kern-orm/types"

import { createEvent, createFixture, createUuid } from "./fixture.ts"
import type { Topic } from "./scenario.ts"

const decoding: Topic = {
  "1000 records of 10 columns": async () => {
    const rows: TextValue[][] = []
    for (let index = 0; index < 1000; index++) {
      rows.push(createEventRow(index))
    }
    const { db } = createFixture(createResult(eventColumns, rows))
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
  "1000 records of 10 boolean columns": createColumnsScenario(
    t.boolean,
    (index, column) => ((index + column) % 3 === 0 ? "f" : "t"),
    true,
  ),
  "1000 records of 10 bytea columns of 32 bytes": createColumnsScenario(
    t.bytea,
    (index, column) => `\\x${((index + column) % 256).toString(16).padStart(2, "0").repeat(32)}`,
    new Uint8Array(32).fill(13),
  ),
  "1000 records of 10 date columns": createColumnsScenario(
    t.date,
    (index, column) => createDateText(index + column),
    "2026-01-14",
  ),
  "1000 records of 10 time columns": createColumnsScenario(
    t.time,
    (index, column) => createTimeText(index + column),
    "13:15:30.500000",
  ),
  "1000 records of 10 timestamp columns": createColumnsScenario(
    t.timestamp,
    (index, column) => `${createDateText(index + column)} ${createTimeText(index + column)}`,
    "2026-01-14T13:15:30.500000",
  ),
  "1000 records of 10 timestamptz columns in UTC": createColumnsScenario(
    t.timestamptz,
    (index, column) => `${createDateText(index + column)} ${createTimeText(index + column)}+00`,
    "2026-01-14T13:15:30.500000Z",
  ),
  "1000 records of 10 timestamptz columns with nonzero offsets": createColumnsScenario(
    t.timestamptz,
    (index, column) => {
      const value = index + column
      return `${createDateText(value)} ${createTimeText(value)}${value % 2 ? "+07" : "-03:30"}`
    },
    "2026-01-14T06:15:30.500000Z",
  ),
  "100 records of a vector of 1536 dimensions": async () => {
    const rows: TextValue[][] = []
    for (let index = 0; index < 100; index++) {
      const values: number[] = []
      for (let dimension = 0; dimension < 1536; dimension++) {
        values.push(Math.round(Math.sin(index * 1536 + dimension) * 1e6) / 1e6)
      }
      rows.push([`[${values.join(",")}]`])
    }
    const { db } = createFixture(createResult(["embedding"], rows))
    const query = db.$query`SELECT embedding`.pluck(t.vector)
    const vectors = await query
    assert.equal(vectors.length, 100)
    assert.equal(vectors[1]!.length, 1536)
    assert.equal(vectors[1]![2], Math.round(Math.sin(1538) * 1e6) / 1e6)
    return async () => await query
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
    const { db } = createFixture(createResult(["id", "name", "fields"], rows))
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
}

/** Names of the result columns of the scenarios of columns of one type. */
const sameTypeColumns = ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"]

/**
 * Creates a scenario of 1000 records of 10 columns of `type`, whose values `createText` gives as PostgreSQL returns them.
 *
 * It checks that the value of record 10 in column 3 decodes to `expected`.
 */
function createColumnsScenario(
  type: AnyType,
  createText: (index: number, column: number) => string,
  expected: unknown,
) {
  return async () => {
    const rows: TextValue[][] = []
    for (let index = 0; index < 1000; index++) {
      const row: TextValue[] = []
      for (let column = 0; column < sameTypeColumns.length; column++) {
        row.push(createText(index, column))
      }
      rows.push(row)
    }
    const fields: Record<string, AnyType> = {}
    for (const column of sameTypeColumns) {
      fields[column] = type
    }
    const { db } = createFixture(createResult(sameTypeColumns, rows))
    const query = db.$query`SELECT`.select(fields)
    const records = await query
    assert.equal(records.length, 1000)
    assert.deepEqual(records[10]!.c3, expected)
    return async () => await query
  }
}

function createDateText(value: number): string {
  return `2026-01-${String(1 + (value % 28)).padStart(2, "0")}`
}

function createTimeText(value: number): string {
  const fraction = ["", ".5", ".123456"][value % 3]
  return `${String(value % 24).padStart(2, "0")}:15:30${fraction}`
}

/** Result of a `SELECT` of `rows` with result `columns`. */
function createResult(columns: string[], rows: TextValue[][]): DriverResult {
  return {
    command: "SELECT",
    count: rows.length,
    columns: columns.map(name => ({ name, type: 25 })),
    rows,
  }
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
