import { describe, expect, it } from "bun:test"

import type { RecordingDriverOptions } from "../../../testing/database/recording-driver"
import { createRecordingDriver } from "../../../testing/database/recording-driver"
import { createStatement } from "../driver"
import { ConnectionError, QueryError } from "../driver-error"

import { ConnectionWatch, TransactionConnectionError } from "./connection-loss"
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

  it("recognizes an error of another copy of kern-orm by its own brand", () => {
    const transactionError = Object.assign(new Error("lost"), {
      [Symbol.for("kern-orm.ConnectionError")]: true,
      [Symbol.for("kern-orm.TransactionConnectionError")]: true,
      phase: "transaction",
    })
    const connectionError = Object.assign(new Error("lost"), {
      [Symbol.for("kern-orm.ConnectionError")]: true,
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
