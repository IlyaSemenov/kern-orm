import { expect, it } from "bun:test"

import { createRecordingDriver } from "../../testing/recording-driver"

import { describeDriverContract } from "./driver-contract"

/** Returns the names of the tests that `describeDriverContract` declares, which never run. */
function collectTestNames(closesReservedConnections: boolean): string[] {
  const names: string[] = []
  const createDriver = () => ({ ...createRecordingDriver().driver, closesReservedConnections })
  describeDriverContract(
    {
      createDriver,
      createDriverWithFailingParsers: createDriver,
    },
    {
      describe: (_name, body) => body(),
      it: name => names.push(name),
      before: () => {},
      after: () => {},
    },
  )
  return names
}

it("declares tests of a connection left in a transaction or lost only for a driver that can close it", () => {
  const names = collectTestNames(true)

  expect(names.filter(name => !collectTestNames(false).includes(name))).toEqual([
    "does not return a connection in an open transaction to the pool",
    "does not return a connection in a failed transaction to the pool",
    "rejects a transaction whose connection is lost and keeps the pool usable",
    "rejects a statement of a transaction whose connection is lost with ConnectionError",
  ])
})
