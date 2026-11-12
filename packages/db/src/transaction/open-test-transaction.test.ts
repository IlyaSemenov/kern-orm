import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"

import { createStatement } from "../driver"
import { ConnectionError, QueryError } from "../driver-error"

import { TransactionCoordinator } from "./coordinator"
import {
  createTestCoordinator,
  failOn,
  holdOn,
  markHandled,
  run,
  seedNothing,
  settleCallbacks,
} from "./testing"

const texts = (statements: readonly { text: string }[]) => statements.map(({ text }) => text)

it("runs each statement of a callback in a savepoint of its own, nested in the innermost fixture", async () => {
  const { coordinator, statements, releases } = createTestCoordinator()

  const fixture = await coordinator.createTestFixture(seedNothing)
  const opened = await coordinator.openTestTransaction()
  await opened.run(run(coordinator, "query"))
  const closing = opened.close()
  expect(opened.close()).toBe(closing)
  await closing
  await fixture.close()

  expect(texts(statements)).toEqual([
    "BEGIN",
    "SAVEPOINT kern_1",
    "RELEASE SAVEPOINT kern_1",
    "SAVEPOINT kern_1",
    "SAVEPOINT kern_2",
    "query",
    "RELEASE SAVEPOINT kern_2",
    "ROLLBACK TO SAVEPOINT kern_1",
    "RELEASE SAVEPOINT kern_1",
    "ROLLBACK",
  ])
  expect(releases).toEqual([{ connection: 1 }])
})

it("rolls back a failed statement to its own savepoint, so the next statement runs", async () => {
  const failure = new QueryError("duplicate key", { code: "23505" })
  const { coordinator, statements } = createTestCoordinator({ respond: failOn("bad", failure) })

  const opened = await coordinator.openTestTransaction()
  await expect(opened.run(run(coordinator, "bad"))).rejects.toBe(failure)
  await opened.run(run(coordinator, "good"))
  await opened.close()

  expect(texts(statements)).toEqual([
    "BEGIN",
    "SAVEPOINT kern_1",
    "bad",
    "ROLLBACK TO SAVEPOINT kern_1",
    "RELEASE SAVEPOINT kern_1",
    "SAVEPOINT kern_1",
    "good",
    "RELEASE SAVEPOINT kern_1",
    "ROLLBACK",
  ])
})

it("makes the statements of other callbacks wait for a transaction of a callback", async () => {
  const inside = holdOn("inside")
  const { coordinator, statements } = createTestCoordinator({ respond: inside.respond })

  const opened = await coordinator.openTestTransaction()
  const transaction = opened.run(() => coordinator.transaction(run(coordinator, "inside")))
  await inside.reached
  const other = opened.run(run(coordinator, "other"))
  await settleCallbacks()

  expect(texts(statements)).toEqual(["BEGIN", "SAVEPOINT kern_1", "inside"])
  inside.resume()
  await Promise.all([transaction, other])
  await opened.close()
  expect(texts(statements)).toEqual([
    "BEGIN",
    "SAVEPOINT kern_1",
    "inside",
    "RELEASE SAVEPOINT kern_1",
    "SAVEPOINT kern_1",
    "other",
    "RELEASE SAVEPOINT kern_1",
    "ROLLBACK",
  ])
})

it("rejects when aborted while a nested test transaction waits for its turn, without starting it", async () => {
  const inside = holdOn("inside")
  const { coordinator, statements } = createTestCoordinator({ respond: inside.respond })
  const controller = new AbortController()
  const reason = new Error("test aborted")

  const opened = await coordinator.openTestTransaction()
  const holder = opened.run(() => coordinator.transaction(run(coordinator, "inside")))
  await inside.reached
  let called = false
  const aborted = opened.run(() =>
    coordinator.testTransaction(
      async () => {
        called = true
      },
      { signal: controller.signal },
    ),
  )
  await settleCallbacks()
  controller.abort(reason)

  await expect(aborted).rejects.toBe(reason)
  inside.resume()
  await holder
  await opened.close()
  expect(called).toBe(false)
  expect(texts(statements)).toEqual([
    "BEGIN",
    "SAVEPOINT kern_1",
    "inside",
    "RELEASE SAVEPOINT kern_1",
    "ROLLBACK",
  ])
})

it("rolls back a running transaction of a callback on closing, and rejects the waiting and later statements", async () => {
  const inside = holdOn("inside")
  const { coordinator, statements, releases } = createTestCoordinator({ respond: inside.respond })
  const { promise: resumed, resolve: resumeLate } = Promise.withResolvers<void>()

  const opened = await coordinator.openTestTransaction()
  const transaction = markHandled(
    opened.run(() => coordinator.transaction(run(coordinator, "inside"))),
  )
  await inside.reached
  const waiting = markHandled(opened.run(run(coordinator, "waiting")))
  const late = markHandled(
    opened.run(async () => {
      await resumed
      await coordinator.execute(createStatement("late"))
    }),
  )
  const closing = opened.close()

  // The waiting statement rejects at once, while the statement of the transaction still runs.
  await expect(waiting).rejects.toThrow(
    "Cannot execute a query: its transaction is already finished",
  )
  inside.resume()
  await closing
  resumeLate()
  await expect(late).rejects.toThrow("Cannot execute a query: its transaction is already finished")
  await expect(transaction).rejects.toThrow(
    "Transaction was rolled back: its enclosing transaction ended first",
  )
  await expect(opened.run(run(coordinator, "after"))).rejects.toThrow(
    "Cannot run a callback in the test transaction: it is already closed",
  )
  expect(texts(statements)).toEqual([
    "BEGIN",
    "SAVEPOINT kern_1",
    "inside",
    "ROLLBACK TO SAVEPOINT kern_1",
    "RELEASE SAVEPOINT kern_1",
    "ROLLBACK",
  ])
  expect(releases).toEqual([{ connection: 1 }])
})

it("rejects a callback in the context of a closed test transaction without calling it", async () => {
  const { coordinator } = createTestCoordinator()

  const opened = await coordinator.openTestTransaction()
  let called = false
  await expect(
    opened.run(async () => {
      await opened.close()
      await opened.run(async () => {
        called = true
      })
    }),
  ).rejects.toThrow("Cannot run a callback in the test transaction: it is already closed")
  expect(called).toBe(false)
})

it("runs a callback in the context of the same test transaction, and rejects it inside a transaction", async () => {
  const { coordinator } = createTestCoordinator()

  const opened = await coordinator.openTestTransaction()
  await opened.run(async () => {
    expect(coordinator.isInTransaction()).toBe(false)
    await opened.run(run(coordinator, "same"))
    await coordinator.transaction(async () => {
      await expect(opened.run(run(coordinator, "inside"))).rejects.toThrow(
        "Cannot run a callback in an open test transaction inside a transaction",
      )
    })
  })
  await opened.close()
})

it("is rolled back by a test transaction and by closing its fixture", async () => {
  const { coordinator, statements } = createTestCoordinator()

  const fixture = await coordinator.createTestFixture(seedNothing)
  const preempted = await coordinator.openTestTransaction()
  await coordinator.testTransaction(run(coordinator, "test"))
  const next = await coordinator.openTestTransaction()

  await expect(preempted.run(run(coordinator, "late"))).rejects.toThrow(
    "Cannot run a callback in the test transaction: it is already closed",
  )
  await preempted.close()
  await next.run(run(coordinator, "next"))
  await fixture.close()
  await expect(next.run(run(coordinator, "late"))).rejects.toThrow(
    "Cannot run a callback in the test transaction: it is already closed",
  )
  expect(texts(statements).slice(3)).toEqual([
    "SAVEPOINT kern_1",
    "ROLLBACK TO SAVEPOINT kern_1",
    "RELEASE SAVEPOINT kern_1",
    "SAVEPOINT kern_1",
    "test",
    "ROLLBACK TO SAVEPOINT kern_1",
    "RELEASE SAVEPOINT kern_1",
    "SAVEPOINT kern_1",
    "SAVEPOINT kern_2",
    "next",
    "RELEASE SAVEPOINT kern_2",
    "ROLLBACK TO SAVEPOINT kern_1",
    "RELEASE SAVEPOINT kern_1",
    "ROLLBACK",
  ])
})

it("rejects the later statements once the savepoint of a statement fails to release", async () => {
  const failure = new ConnectionError("release failed")
  const { coordinator } = createTestCoordinator({
    respond: failOn("RELEASE SAVEPOINT kern_1", failure),
  })

  const opened = await coordinator.openTestTransaction()
  await expect(opened.run(run(coordinator, "query"))).rejects.toBe(failure)
  await expect(opened.run(run(coordinator, "next"))).rejects.toThrow(
    "Cannot execute a query: a nested transaction failed to end, so the transaction can only roll back",
  )
  await opened.close()
})

it("rejects on a coordinator not created for tests and inside a transaction", async () => {
  const { driver } = createRecordingDriver()
  const { coordinator } = createTestCoordinator()

  await expect(new TransactionCoordinator(driver).openTestTransaction()).rejects.toThrow(
    "openTestTransaction requires a database created with test: true",
  )
  await coordinator.testTransaction(async () => {
    await expect(coordinator.openTestTransaction()).rejects.toThrow(
      "Cannot open a test transaction inside a transaction",
    )
  })
})

describe("closing the database", () => {
  it("rolls back an open test transaction on a connection of its own before closing the driver", async () => {
    const { coordinator, statements, releases } = createTestCoordinator()

    const opened = await coordinator.openTestTransaction()
    await coordinator.close()

    await expect(opened.run(run(coordinator, "late"))).rejects.toThrow(
      "Cannot run a callback in the test transaction: it is already closed",
    )
    expect(texts(statements)).toEqual(["BEGIN", "ROLLBACK"])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("releases the connection of a test transaction that opens while the closing waits for it", async () => {
    const acquiring = Promise.withResolvers<void>()
    const { coordinator, statements, releases } = createTestCoordinator({
      acquire: () => acquiring.promise,
    })

    const opening = markHandled(coordinator.openTestTransaction())
    await settleCallbacks()
    const closing = coordinator.close()
    acquiring.resolve()

    await expect(opening).rejects.toThrow("Cannot open a test transaction: the database is closed")
    await closing
    expect(statements).toEqual([])
    expect(releases).toEqual([{ connection: 1 }])
  })

  it("rolls back a test transaction whose BEGIN runs while the closing starts", async () => {
    const begin = holdOn("BEGIN")
    const { coordinator, statements, releases } = createTestCoordinator({
      respond: begin.respond,
    })

    const opening = markHandled(coordinator.openTestTransaction())
    await begin.reached
    const closing = coordinator.close()
    begin.resume()

    await expect(opening).rejects.toThrow("Cannot open a test transaction: the database is closed")
    await closing
    expect(texts(statements)).toEqual(["BEGIN", "ROLLBACK"])
    expect(releases).toEqual([{ connection: 1 }])
  })
})
