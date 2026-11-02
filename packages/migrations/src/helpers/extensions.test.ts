import { describe, expect, it } from "bun:test"

import * as t from "kern-orm/types"

import { countLockWaiters, waitFor } from "../../testing/concurrency"
import { describePooledPostgres, describePostgres } from "../../testing/postgres"
import { quoteIdentifier } from "../sql"

import { createExtension } from "./extensions"

// The key of the lock that createExtension takes.
const lockKey = "@kern-orm/migrations createExtension"

describe("createExtension", () => {
  it("creates an extension unless it exists, locking extensions before the second check, and does nothing on rollback", () => {
    expect(createExtension("pg_trgm")).toEqual({
      up: `DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('${lockKey}', 0));
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm') THEN
      CREATE EXTENSION "pg_trgm";
    END IF;
  END IF;
END
$$`,
    })
  })

  it("creates the schema of an extension when it is missing, before the extension", () => {
    expect(createExtension("pg_trgm", { schema: "extensions" })).toEqual({
      up: `DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('${lockKey}', 0));
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm') THEN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_namespace WHERE nspname = 'extensions') THEN
        CREATE SCHEMA IF NOT EXISTS "extensions";
      END IF;
      CREATE EXTENSION "pg_trgm" WITH SCHEMA "extensions";
    END IF;
  END IF;
END
$$`,
    })
  })

  it("quotes its body with a dollar tag that the names do not contain", () => {
    expect(createExtension("citext", { schema: "a$$b" }).up).toStartWith("DO $_$\n")
    expect(createExtension("citext", { schema: "a$$b$_$c" }).up).toStartWith("DO $__$\n")
  })
})

describePostgres("createExtension in PostgreSQL", ({ database, testTransaction, notices }) => {
  it("creates the extension and its missing schema, and skips them silently when they exist", async () => {
    const schema = `migrations_ext$$archive's "x"`
    notices.length = 0

    const result = await testTransaction(async () => {
      await database.script(createExtension("citext", { schema }).up as string)
      await database.script(createExtension("citext", { schema }).up as string)
      await database.script(createExtension("pg_trgm", { schema }).up as string)
      return await database.query`
        SELECT extname::text AS name, extnamespace::regnamespace::text AS schema FROM pg_catalog.pg_extension
        WHERE extname IN ('citext', 'pg_trgm') ORDER BY extname
      `.select({ name: t.text, schema: t.text })
    })

    expect(result).toEqual([
      { name: "citext", schema: quoteIdentifier(schema) },
      { name: "pg_trgm", schema: quoteIdentifier(schema) },
    ])
    expect(notices).toEqual([])
  })
})

describePooledPostgres("concurrent createExtension calls", ({ database }) => {
  const step = createExtension("citext", { schema: "migrations_extensions" })

  /**
   * Creates the extension with its schema in two transactions at once, the first of which ends with `outcome` while the second waits for it.
   *
   * It resolves to how the first transaction ended and to the schema of the extension afterwards, and drops the extension and its schema once both transactions end.
   */
  async function createTwice(outcome: "commit" | "rollback") {
    const gate = Promise.withResolvers<void>()
    let created = false
    const first = database.transaction(async () => {
      await database.script(step.up as string)
      created = true
      await gate.promise
      if (outcome === "rollback") {
        throw new Error("Rolled back")
      }
    })
    // Keeps a rejection before the test awaits the transaction from being reported as unhandled.
    first.catch(() => {})
    let second: Promise<void> | undefined
    try {
      await waitFor(async () => created)
      second = database.transaction(() => database.script(step.up as string))
      second.catch(() => {})
      await waitFor(async () => (await countLockWaiters(database, lockKey)) === 1)
      gate.resolve()
      const ended = await first.then(
        () => "commit",
        () => "rollback",
      )
      await second
      return {
        ended,
        extensions: await database.query`
          SELECT extnamespace::regnamespace::text FROM pg_catalog.pg_extension WHERE extname = 'citext'
        `.pluck(t.text),
      }
    } finally {
      gate.resolve()
      await Promise.allSettled([first, second])
      await database.script(
        "DROP EXTENSION IF EXISTS citext; DROP SCHEMA IF EXISTS migrations_extensions",
      )
    }
  }

  it("waits for a migration that creates the extension and skips it after the commit", async () => {
    expect(await createTwice("commit")).toEqual({
      ended: "commit",
      extensions: ["migrations_extensions"],
    })
  })

  it("waits for a migration that creates the extension and creates it after the rollback", async () => {
    expect(await createTwice("rollback")).toEqual({
      ended: "rollback",
      extensions: ["migrations_extensions"],
    })
  })
})
