import { describe, expect, it } from "bun:test"

import { TurnQueue } from "./turns"

/** Takes a turn of `turns` and records when it comes under `label`. */
function takeTurn(turns: TurnQueue, events: string[], label: string, signal?: AbortSignal) {
  return turns.take(signal).then(() => {
    events.push(label)
  })
}

it("grants the turns one at a time in the order they were asked for", async () => {
  const turns = new TurnQueue()
  const events: string[] = []

  await takeTurn(turns, events, "holder")
  const waiter1 = takeTurn(turns, events, "waiter 1")
  const waiter2 = takeTurn(turns, events, "waiter 2")
  await Promise.resolve()
  expect(events).toEqual(["holder"])

  turns.release()
  await waiter1
  expect(events).toEqual(["holder", "waiter 1"])
  turns.release()
  await waiter2
  expect(events).toEqual(["holder", "waiter 1", "waiter 2"])
  turns.release()
  await takeTurn(turns, events, "after")
  expect(events).toEqual(["holder", "waiter 1", "waiter 2", "after"])
})

it("grants every waiter and every later caller once closed", async () => {
  const turns = new TurnQueue()
  const events: string[] = []

  await takeTurn(turns, events, "holder")
  const waiters = [takeTurn(turns, events, "waiter 1"), takeTurn(turns, events, "waiter 2")]
  turns.close()
  await Promise.all(waiters)
  turns.release()
  await takeTurn(turns, events, "after")

  expect(events).toEqual(["holder", "waiter 1", "waiter 2", "after"])
})

describe("abort signal", () => {
  it("rejects a signal aborted before the call without taking the free turn", async () => {
    const turns = new TurnQueue()
    const events: string[] = []
    const reason = new Error("aborted")

    await expect(turns.take(AbortSignal.abort(reason))).rejects.toBe(reason)
    await takeTurn(turns, events, "next")

    expect(events).toEqual(["next"])
  })

  it("rejects a waiter at once when its signal aborts, and passes the turn to the next waiter", async () => {
    const turns = new TurnQueue()
    const events: string[] = []
    const controller = new AbortController()
    const reason = new Error("aborted")

    await takeTurn(turns, events, "holder")
    const aborted = takeTurn(turns, events, "aborted", controller.signal)
    const next = takeTurn(turns, events, "next")
    controller.abort(reason)

    await expect(aborted).rejects.toBe(reason)
    expect(events).toEqual(["holder"])
    turns.release()
    await next
    expect(events).toEqual(["holder", "next"])
  })

  it("keeps the turn of a waiter whose signal aborts after the turn is granted", async () => {
    const turns = new TurnQueue()
    const events: string[] = []
    const controller = new AbortController()

    await takeTurn(turns, events, "holder")
    const granted = takeTurn(turns, events, "granted", controller.signal)
    const next = takeTurn(turns, events, "next")
    turns.release()
    controller.abort()
    await granted
    await Promise.resolve()

    // The granted waiter holds the turn until it releases it.
    expect(events).toEqual(["holder", "granted"])
    turns.release()
    await next
    expect(events).toEqual(["holder", "granted", "next"])
  })
})
