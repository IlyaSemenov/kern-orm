// Time of building a query of many values, each of which becomes a parameter, an expression, or a query of one value, apart from compiling it, which `preparation.bench.ts` measures.
// Each scenario builds its query on every call from values prepared once: strings, `Date` objects, and records of several types.

import { createEvent, createFixture, createUuid } from "./fixture.ts"
import type { Topic } from "./scenario.ts"

const building: Topic = build => {
  const { db } = createFixture(build)

  return {
    "in of 1000 strings": () => {
      const ids: string[] = []
      for (let index = 0; index < 1000; index++) {
        ids.push(createUuid(index))
      }
      return () => db.form.where(form => form.id.in(ids))
    },
    "in of 1000 dates": () => {
      const dates: Date[] = []
      for (let index = 0; index < 1000; index++) {
        dates.push(new Date(Date.UTC(2026, 0, 1) + index * 1000))
      }
      return () => db.event.where(event => event.createdAt.in(dates))
    },
    "insert of 1000 events": () => {
      const events: ReturnType<typeof createEvent>[] = []
      for (let index = 0; index < 1000; index++) {
        events.push(createEvent(index))
      }
      return () => db.event.insertMany(events)
    },
  }
}

export default building
