import { describe, expect, it } from "bun:test"

import type { RecordingDriverOptions } from "@kern-orm/test-harness/recording-driver"
import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"

import { createStatement } from "../driver"
import { ConnectionError, QueryError } from "../driver-error"

import { ConnectionWatch, isOutcomeUnknown, TransactionConnectionError } from "./connection-loss"
import { failOn, holdOn } from "./testing"

describe("TransactionConnectionError", () => {
  it("names itself and keeps its phase and cause", () => {
    const cause = new ConnectionError("Connection terminated")
    const error = new TransactionConnectionError("commit", { cause })

    expect(error).toMatchObject({
      name: "TransactionConnectionError",
      message: "Transaction may have been committed: its connection failed during COMMIT",
      phase: "commit",
      cause,
    })
    expect(error).toBeInstanceOf(ConnectionError)
  })

  it("keeps its brands out of the enumerable fields", () => {
    expect(Object.keys(new TransactionConnectionError("begin"))).toEqual(["name", "phase"])
  })

  it("recognizes an error of another copy of kern-db by its own brand", () => {
    const transactionError = Object.assign(new Error("lost"), {
      [Symbol.for("kern-db.ConnectionError")]: true,
      [Symbol.for("kern-db.TransactionConnectionError")]: true,
      phase: "transaction",
    })
    const connectionError = Object.assign(new Error("lost"), {
      [Symbol.for("kern-db.ConnectionError")]: true,
    })

    expect(transactionError instanceof TransactionConnectionError).toBe(true)
    expect(transactionError instanceof ConnectionError).toBe(true)
    expect(connectionError instanceof TransactionConnectionError).toBe(false)
    expect(new ConnectionError("lost") instanceof TransactionConnectionError).toBe(false)
  })

  it("recognizes an instance of a subclass by its prototype", () => {
    class RetriedTransactionError extends TransactionConnectionError {}
    const subclassed = new RetriedTransactionError("transaction")

    expect(subclassed instanceof RetriedTransactionError).toBe(true)
    expect(subclassed instanceof TransactionConnectionError).toBe(true)
    expect(new TransactionConnectionError("transaction") instanceof RetriedTransactionError).toBe(
      false,
    )
  })
})

describe("isOutcomeUnknown", () => {
  it("is true for a transaction whose connection failed during COMMIT and for another ConnectionError", () => {
    expect(isOutcomeUnknown(new TransactionConnectionError("commit"))).toBe(true)
    expect(isOutcomeUnknown(new ConnectionError("lost"))).toBe(true)
  })

  it("is false for a transaction that was not committed and for another error", () => {
    expect(isOutcomeUnknown(new TransactionConnectionError("begin"))).toBe(false)
    expect(isOutcomeUnknown(new TransactionConnectionError("transaction"))).toBe(false)
    expect(isOutcomeUnknown(new QueryError("rejected", { code: "23505" }))).toBe(false)
    expect(isOutcomeUnknown(new Error("decode"))).toBe(false)
    expect(isOutcomeUnknown(undefined)).toBe(false)
  })

  it("recognizes the errors of another copy of kern-db by their brands", () => {
    const connectionError = Object.assign(new Error("lost"), {
      [Symbol.for("kern-db.ConnectionError")]: true,
    })
    const committing = Object.assign(new Error("commit"), {
      [Symbol.for("kern-db.ConnectionError")]: true,
      [Symbol.for("kern-db.TransactionConnectionError")]: true,
      phase: "commit",
    })
    const rolledBack = Object.assign(new Error("transaction"), {
      [Symbol.for("kern-db.ConnectionError")]: true,
      [Symbol.for("kern-db.TransactionConnectionError")]: true,
      phase: "transaction",
    })

    expect(isOutcomeUnknown(connectionError)).toBe(true)
    expect(isOutcomeUnknown(committing)).toBe(true)
    expect(isOutcomeUnknown(rolledBack)).toBe(false)
  })
})

describe("ConnectionWatch", () => {
  /** Watch of a connection of a recording driver that answers with `respond`. */
  async function watchConnection(respond: RecordingDriverOptions["respond"]) {
    const { driver } = createRecordingDriver({ respond })
    return new ConnectionWatch(await driver.acquire())
  }

  it("records the first ConnectionError of a statement or a script with the phase, and rejects with it", async () => {
    const firstError = new ConnectionError("first")
    const watch = await watchConnection(({ text }) => {
      if (text === "first") {
        throw firstError
      }
      if (text === "second") {
        throw new ConnectionError("second")
      }
      return {}
    })
    watch.phase = "transaction"

    await expect(watch.executeScript("first")).rejects.toBe(firstError)
    watch.phase = "commit"
    await expect(watch.execute(createStatement("second"))).rejects.toThrow("second")
    await watch.execute(createStatement("succeeds"))

    expect(watch.failure).toEqual({ error: firstError, phase: "transaction" })
  })

  it("ignores a QueryError", async () => {
    const watch = await watchConnection(
      failOn("rejected", new QueryError("rejected", { code: "22012" })),
    )

    await expect(watch.execute(createStatement("rejected"))).rejects.toBeInstanceOf(QueryError)

    expect(watch.failure).toBeUndefined()
  })

  it("takes the phase when the rejection comes rather than when the statement was sent", async () => {
    const lost = new ConnectionError("lost")
    const held = holdOn("held", 1, lost)
    const watch = await watchConnection(held.respond)
    watch.phase = "transaction"

    const statement = watch.execute(createStatement("held")).catch(() => {})
    await held.reached
    watch.phase = "commit"
    held.resume()
    await statement

    expect(watch.failure).toEqual({ error: lost, phase: "commit" })
  })
})
