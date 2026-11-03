// Time of preparing a statement, lowering and compiling a query to its SQL text and parameters, as every execution of a query does, measured through `db.$compile`.
// Each scenario compiles a query built once, apart from one that also builds it on every call.
// Apart from the scenario of `exists`, the queries hold no queries in their expressions, where lowering finds nothing to replace.

import type { Predicate } from "kern-orm"

import { createEvent, createFixture, createUuid } from "./fixture.ts"
import type { Topic } from "./scenario.ts"
import { unsupported } from "./scenario.ts"

const preparation: Topic = build => {
  const { orm } = build
  const { db } = createFixture(build)

  const selectForms = () =>
    db.form
      .where({ published: true })
      .where(form => form.name.ilike("draft%"))
      .where(form => form.position.gt(3))
      .orderBy({ position: "desc" }, "name")
      .limit(20)
      .select("id", "name", "position")

  return {
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
      const ids: string[] = []
      for (let index = 0; index < 1000; index++) {
        ids.push(createUuid(index))
      }
      const query = db.form.where(form => form.id.in(ids)).select("id")
      return () => db.$compile(query)
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
            return depth % 2 === 0 ? orm.and(left, right) : orm.or(left, right)
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
      let relations = false
      db.form.where(form => {
        relations = "fields" in form
        return { published: true }
      })
      if (!relations) {
        return unsupported("the callback of where receives no relations")
      }
      const query = db.form
        .where(form => form.fields.where({ label: "Email" }).exists())
        .select("id")
      return () => db.$compile(query)
    },
  }
}

export default preparation
