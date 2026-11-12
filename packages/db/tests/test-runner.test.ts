// Runs test transactions under `bun test` itself, whose timeouts, retries, preloads, and test files a single test cannot reproduce.
import { describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import type { RecordedRelease, RecordedStatement } from "@kern-orm/test-harness/recording-driver"

/** Runs `bun test` with `args` in the runner directory and returns the result its tests print, with the names of the failed tests and whether it reported an error outside of tests. */
function runBunTest(args: string[]) {
  const { stdout, stderr, error } = spawnSync("bun", ["test", ...args], {
    cwd: fileURLToPath(new URL("runner", import.meta.url)),
    encoding: "utf8",
    // `spawnSync` blocks the event loop, so the timeout of the calling test cannot stop a runner that hangs.
    timeout: 30_000,
  })
  expect(error).toBeUndefined()
  const line = stdout.split("\n").find(text => text.startsWith("RESULT "))
  expect(line).toBeDefined()
  const failed: string[] = []
  for (const text of stderr.split("\n")) {
    const match = /^\(fail\) (.+) \[[\d.]+m?s\]$/.exec(text)
    if (match) {
      failed.push(match[1]!)
    }
  }
  const result = JSON.parse(line!.slice("RESULT ".length)) as {
    statements: RecordedStatement[]
    releases?: RecordedRelease[]
    lateResults?: string[]
  }
  return { ...result, failed, unhandledError: stderr.includes("Unhandled error") }
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

describe("wrapped test function", () => {
  it("runs every test of its modifiers in its own transaction, and rolls back a timed-out test or attempt at once", () => {
    const { statements, lateResults, failed, unhandledError } = runBunTest(["./wrapped-test.ts"])

    expect(failed).toEqual(["times out", "fails"])
    expect(unhandledError).toBe(false)
    expect(statements.map(({ connection, text }) => `${connection}: ${text}`)).toEqual([
      "1: BEGIN",
      "1: SAVEPOINT kern_1",
      "1: timed out",
      "1: RELEASE SAVEPOINT kern_1",
      // onTestFinished aborts the timed-out test before the next test starts.
      "1: ROLLBACK",
      "2: BEGIN",
      "2: SAVEPOINT kern_1",
      "2: next",
      "2: RELEASE SAVEPOINT kern_1",
      "2: ROLLBACK",
      "3: BEGIN",
      "3: SAVEPOINT kern_1",
      "3: fails",
      "3: RELEASE SAVEPOINT kern_1",
      "3: ROLLBACK",
      "4: BEGIN",
      "4: SAVEPOINT kern_1",
      "4: attempt 1",
      "4: RELEASE SAVEPOINT kern_1",
      // bun:test runs onTestFinished after each attempt.
      "4: ROLLBACK",
      "5: BEGIN",
      "5: SAVEPOINT kern_1",
      "5: attempt 2",
      "5: RELEASE SAVEPOINT kern_1",
      "5: ROLLBACK",
      "6: BEGIN",
      "6: SAVEPOINT kern_1",
      "6: row 1",
      "6: RELEASE SAVEPOINT kern_1",
      "6: ROLLBACK",
      "7: BEGIN",
      "7: SAVEPOINT kern_1",
      "7: row 2",
      "7: RELEASE SAVEPOINT kern_1",
      "7: ROLLBACK",
      "8: BEGIN",
      "8: SAVEPOINT kern_1",
      "8: conditional",
      "8: RELEASE SAVEPOINT kern_1",
      "8: ROLLBACK",
      "9: BEGIN",
      "9: SAVEPOINT kern_1",
      "9: SAVEPOINT kern_2",
      "9: fixture data",
      "9: RELEASE SAVEPOINT kern_2",
      "9: RELEASE SAVEPOINT kern_1",
      "9: SAVEPOINT kern_1",
      "9: SAVEPOINT kern_2",
      "9: fixture test",
      "9: RELEASE SAVEPOINT kern_2",
      "9: ROLLBACK TO SAVEPOINT kern_1",
      "9: RELEASE SAVEPOINT kern_1",
      "9: ROLLBACK",
    ])
    expect(lateResults).toEqual([
      expect.stringContaining("Cannot execute a query: its transaction is already finished"),
    ])
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
      "1: SAVEPOINT kern_2",
      "1: migrate",
      "1: RELEASE SAVEPOINT kern_2",
      "1: RELEASE SAVEPOINT kern_1",
      "1: SAVEPOINT kern_1",
      "1: SAVEPOINT kern_2",
      "1: SAVEPOINT kern_3",
      "1: file 1 data",
      "1: RELEASE SAVEPOINT kern_3",
      "1: RELEASE SAVEPOINT kern_2",
      "1: SAVEPOINT kern_2",
      "1: SAVEPOINT kern_3",
      "1: timed out",
      "1: RELEASE SAVEPOINT kern_3",
      // The next test preempts the timed-out one.
      "1: ROLLBACK TO SAVEPOINT kern_2",
      "1: RELEASE SAVEPOINT kern_2",
      "1: SAVEPOINT kern_2",
      "1: SAVEPOINT kern_3",
      "1: next",
      "1: RELEASE SAVEPOINT kern_3",
      "1: ROLLBACK TO SAVEPOINT kern_2",
      "1: RELEASE SAVEPOINT kern_2",
      "1: ROLLBACK TO SAVEPOINT kern_1",
      "1: RELEASE SAVEPOINT kern_1",
      "1: SAVEPOINT kern_1",
      "1: SAVEPOINT kern_2",
      "1: SAVEPOINT kern_3",
      "1: file 2 data",
      "1: RELEASE SAVEPOINT kern_3",
      "1: RELEASE SAVEPOINT kern_2",
      "1: SAVEPOINT kern_2",
      "1: SAVEPOINT kern_3",
      "1: file 2 test",
      "1: RELEASE SAVEPOINT kern_3",
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
      "1: SAVEPOINT kern_2",
      "1: migrate",
      "1: RELEASE SAVEPOINT kern_2",
      "1: RELEASE SAVEPOINT kern_1",
      "1: SAVEPOINT kern_1",
      "1: SAVEPOINT kern_2",
      "1: SAVEPOINT kern_3",
      "1: stuck data",
      "1: RELEASE SAVEPOINT kern_3",
      // The after hook closes the fixture without waiting for its seed.
      "1: ROLLBACK TO SAVEPOINT kern_2",
      "1: RELEASE SAVEPOINT kern_2",
      "1: ROLLBACK TO SAVEPOINT kern_1",
      "1: RELEASE SAVEPOINT kern_1",
      "1: SAVEPOINT kern_1",
      "1: SAVEPOINT kern_2",
      "1: SAVEPOINT kern_3",
      "1: next data",
      "1: RELEASE SAVEPOINT kern_3",
      "1: RELEASE SAVEPOINT kern_2",
      "1: SAVEPOINT kern_2",
      "1: SAVEPOINT kern_3",
      "1: next test",
      "1: RELEASE SAVEPOINT kern_3",
      "1: ROLLBACK TO SAVEPOINT kern_2",
      "1: RELEASE SAVEPOINT kern_2",
      "1: ROLLBACK TO SAVEPOINT kern_1",
      "1: RELEASE SAVEPOINT kern_1",
      "1: ROLLBACK",
    ])
    expect(releases).toEqual([{ connection: 1 }])
  })
})
