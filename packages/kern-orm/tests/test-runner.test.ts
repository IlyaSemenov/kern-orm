// Runs test transactions under `bun test` itself, whose timeouts, retries, preloads, and test files a single test cannot reproduce.
import { describe, expect, it } from "bun:test"

import type { RecordedRelease, RecordedStatement } from "../testing/recording-driver"

/** Runs `bun test` with `args` in the runner directory and returns the result its tests print. */
function runBunTest(args: string[]) {
  const { stdout, exitedDueToTimeout } = Bun.spawnSync({
    cmd: ["bun", "test", ...args],
    cwd: `${import.meta.dir}/runner`,
    // `spawnSync` blocks the event loop, so the timeout of the calling test cannot stop a runner that hangs.
    timeout: 30_000,
  })
  expect(exitedDueToTimeout).toBeFalsy()
  const line = stdout
    .toString()
    .split("\n")
    .find(text => text.startsWith("RESULT "))
  expect(line).toBeDefined()
  return JSON.parse(line!.slice("RESULT ".length)) as {
    statements: RecordedStatement[]
    releases?: RecordedRelease[]
    lateResults?: string[]
  }
}

describe("test transactions", () => {
  it("keeps a timed-out test and every attempt of a retried test in their own transactions", () => {
    const { statements, lateResults } = runBunTest(["./timeout-and-retry.ts"])
    const texts = statements.map(({ text }) => text)
    expect(texts).toEqual(
      expect.arrayContaining(["timed out", "late while running", "next", "attempt 1", "attempt 2"]),
    )
    expect(texts).not.toContain("late after end")
    const connectionOf = (text: string) =>
      statements.find(statement => statement.text === text)!.connection

    expect(connectionOf("late while running")).toBe(connectionOf("timed out"))
    expect(connectionOf("next")).not.toBe(connectionOf("timed out"))
    expect(lateResults).toEqual([
      expect.stringContaining("Cannot execute a query: its transaction is already finished"),
    ])
    expect(connectionOf("attempt 2")).not.toBe(connectionOf("attempt 1"))
    expect(statements.filter(({ text }) => text === "ROLLBACK")).toHaveLength(4)
  })
})

describe("test fixtures", () => {
  it("keeps the fixture of a preload for all test files and the fixtures of a test file and a describe block for their tests", () => {
    const { statements, releases, lateResults } = runBunTest([
      "--preload",
      "./fixtures/preload.ts",
      "./fixtures/file-1.ts",
      "./fixtures/file-2.ts",
    ])

    expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
      "1: BEGIN",
      "1: SAVEPOINT kern_1",
      "1: migrate",
      "1: RELEASE SAVEPOINT kern_1",
      "1: SAVEPOINT kern_1",
      "1: SAVEPOINT kern_2",
      "1: file 1 data",
      "1: RELEASE SAVEPOINT kern_2",
      "1: SAVEPOINT kern_2",
      "1: timed out",
      // The next test preempts the timed-out one.
      "1: ROLLBACK TO SAVEPOINT kern_2",
      "1: RELEASE SAVEPOINT kern_2",
      "1: SAVEPOINT kern_2",
      "1: next",
      "1: ROLLBACK TO SAVEPOINT kern_2",
      "1: RELEASE SAVEPOINT kern_2",
      "1: ROLLBACK TO SAVEPOINT kern_1",
      "1: RELEASE SAVEPOINT kern_1",
      "1: SAVEPOINT kern_1",
      "1: SAVEPOINT kern_2",
      "1: file 2 data",
      "1: RELEASE SAVEPOINT kern_2",
      "1: SAVEPOINT kern_2",
      "1: file 2 test",
      "1: ROLLBACK TO SAVEPOINT kern_2",
      "1: RELEASE SAVEPOINT kern_2",
      "1: ROLLBACK TO SAVEPOINT kern_1",
      "1: RELEASE SAVEPOINT kern_1",
      "1: ROLLBACK",
    ])
    expect(releases).toEqual([{ connection: 1 }])
    expect(lateResults).toEqual([
      expect.stringContaining("Cannot execute a query: its transaction is already finished"),
    ])
  })

  it("closes a fixture whose seed never settles after its before hook times out, and opens the next one", () => {
    const { statements, releases } = runBunTest(["./stuck-seed.ts"])

    expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
      "1: BEGIN",
      "1: SAVEPOINT kern_1",
      "1: migrate",
      "1: RELEASE SAVEPOINT kern_1",
      "1: SAVEPOINT kern_1",
      "1: SAVEPOINT kern_2",
      "1: stuck data",
      // The after hook closes the fixture without waiting for its seed.
      "1: ROLLBACK TO SAVEPOINT kern_2",
      "1: RELEASE SAVEPOINT kern_2",
      "1: ROLLBACK TO SAVEPOINT kern_1",
      "1: RELEASE SAVEPOINT kern_1",
      "1: SAVEPOINT kern_1",
      "1: SAVEPOINT kern_2",
      "1: next data",
      "1: RELEASE SAVEPOINT kern_2",
      "1: SAVEPOINT kern_2",
      "1: next test",
      "1: ROLLBACK TO SAVEPOINT kern_2",
      "1: RELEASE SAVEPOINT kern_2",
      "1: ROLLBACK TO SAVEPOINT kern_1",
      "1: RELEASE SAVEPOINT kern_1",
      "1: ROLLBACK",
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })
})
