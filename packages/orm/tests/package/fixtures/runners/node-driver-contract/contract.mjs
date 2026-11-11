// Runs the driver contract of the packed `kern-orm/testing` with node:test, in PostgreSQL at DATABASE_URL.
import { after, before, describe, it } from "node:test"

import { postgresJsDriver } from "@kern-orm/postgres-js"
import { describeDriverContract } from "kern-orm/testing"
import postgres from "postgres"

const { DATABASE_URL } = process.env

describeDriverContract(
  {
    createDriver: options => postgresJsDriver(postgres(DATABASE_URL, options)),
    createDriverWithFailingParsers: () =>
      postgresJsDriver(
        postgres(DATABASE_URL, {
          // postgres.js reads `integer` values with the parsers while it fetches types, which this parser would fail.
          fetch_types: false,
          types: {
            failing: {
              to: 23,
              from: [23],
              serialize: String,
              parse: () => {
                throw new Error("parsed")
              },
            },
          },
        }),
      ),
  },
  { describe, it, before, after },
)
