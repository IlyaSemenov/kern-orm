// Time of preparing a statement, lowering and compiling a query to its SQL text and parameters, as every execution of a query does, measured through `db.$compile`, and compiling a query of SQL text of the database layer, measured through `toSQL`.
// Each scenario compiles a query built once, apart from one that also builds it on every call.
// The scenarios of `param` measure binding the parameter of each `param` once in a statement: of one `param` at three places, and of 1000 different ones beside the scenarios of 1000 other parameters.
// The scenario of bytea values includes encoding the bytes as hex in preparing the statement.
// Apart from the scenario of `exists`, the queries hold no queries in their expressions, where lowering finds nothing to replace.

import type { Predicate, SqlValue } from "kern-orm"
import { and, or, param, sql } from "kern-orm"
import { param as paramOfLayer, sql as sqlOfLayer } from "kern-orm/db"
import * as t from "kern-orm/types"

import { createEvent, createFixture, createUuid } from "./fixture.ts"
import type { Topic } from "./scenario.ts"

const { db } = createFixture()

const selectForms = () =>
  db.form
    .where({ published: true })
    .where(form => form.name.ilike("draft%"))
    .where(form => form.position.gt(3))
    .orderBy({ position: "desc" }, "name")
    .limit(20)
    .select("id", "name", "position")

/** UUIDs of numbers from 0 to 999. */
function createUuids(): string[] {
  const ids: string[] = []
  for (let index = 0; index < 1000; index++) {
    ids.push(createUuid(index))
  }
  return ids
}

/** Starts the query of SQL text of `values` separated by commas between `head` and `tail`. */
function queryValues(head: string, values: SqlValue[], tail: string) {
  const strings = [head]
  for (let index = 1; index < values.length; index++) {
    strings.push(", ")
  }
  strings.push(tail)
  return db.$database.query(Object.assign(strings, { raw: strings }), ...values)
}

/** Starts the query of SQL text of `SELECT id FROM form WHERE id IN (...)` of `values`. */
const selectFormsIn = (values: SqlValue[]) =>
  queryValues("SELECT id FROM form WHERE id IN (", values, ")")

const preparation: Topic = {
  select: () => {
    const query = selectForms()
    return () => db.$compile(query)
  },
  "select built on each call": () => () => db.$compile(selectForms()),
  "insert of 1000 events": () => {
    const events = []
    for (let index = 0; index < 1000; index++) {
      events.push(createEvent(index))
    }
    const query = db.event.insertMany(events)
    return () => db.$compile(query)
  },
  "in of 1000 values": () => {
    const query = db.form.where(form => form.id.in(createUuids())).select("id")
    return () => db.$compile(query)
  },
  "in of 1000 params": () => {
    const ids = createUuids().map(id => param(t.uuid, id))
    const query = db.form.where(form => form.id.in(ids)).select("id")
    return () => db.$compile(query)
  },
  "select of a param at 3 places": () => {
    const size = param(t.integer, 10)
    const query = db.form
      .where(form => sql(t.integer)`${form.position} / ${size}`.gt(1))
      .select(form => ({
        bucket: sql(t.integer)`${form.position} / ${size}`,
        next: sql(t.integer)`${form.position} / ${size} + 1`,
      }))
    return () => db.$compile(query)
  },
  "query of SQL text of 1000 values": () => {
    const query = selectFormsIn(createUuids())
    return () => query.toSQL()
  },
  "query of SQL text of 1000 bytea values of 32 bytes": () => {
    const values: Uint8Array[] = []
    for (let index = 0; index < 1000; index++) {
      values.push(new Uint8Array(32).fill(index % 256))
    }
    const query = queryValues("SELECT ", values, "")
    return () => query.toSQL()
  },
  "query of SQL text of 1000 params": () => {
    const query = selectFormsIn(createUuids().map(id => paramOfLayer(t.uuid, id)))
    return () => query.toSQL()
  },
  "query of SQL text of a param at 3 places": () => {
    // The time of a statement of a queue of jobs, which it reads at several places.
    const now = sqlOfLayer`coalesce(${paramOfLayer(t.timestamptz.nullable(), null)}, statement_timestamp())`
    const query = db.$database.query`
      UPDATE job SET locked_at = ${now}, locked_by = ${"worker"}, lease_until = ${now} + interval '1 minute'
      WHERE state = ${"pending"} AND run_at <= ${now}
    `
    return () => query.toSQL()
  },
  "and/or tree of 256 conditions": () => {
    // A balanced tree of depth 8 that alternates `and` and `or`.
    const query = db.form
      .where(form => {
        const combine = (depth: number, position: number): Predicate => {
          if (depth === 0) {
            return form.position.gt(position)
          }
          const left = combine(depth - 1, position * 2)
          const right = combine(depth - 1, position * 2 + 1)
          return depth % 2 === 0 ? and(left, right) : or(left, right)
        }
        return combine(8, 0)
      })
      .select("id")
    return () => db.$compile(query)
  },
  "nested relations": () => {
    const query = db.form
      .where({ published: true })
      .orderBy("name")
      .select("id", "name")
      .select(form => ({
        fields: form.fields
          .orderBy("position")
          .select("id", "label")
          .select(field => ({
            answers: field.answers.pluck("value"),
          })),
      }))
    return () => db.$compile(query)
  },
  "exists in a condition": () => {
    const query = db.form.where(form => form.fields.where({ label: "Email" }).exists()).select("id")
    return () => db.$compile(query)
  },
}

export default preparation
