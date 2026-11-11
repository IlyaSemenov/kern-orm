import { describe, expect, it } from "bun:test"

import { createRecordingDriver } from "@kern-orm/test-harness/recording-driver"

import { createDatabase } from "./database"
import { isDriver } from "./driver"

describe("isDriver", () => {
  it("recognizes an object with the methods of a driver, also one written by hand", () => {
    const { driver } = createRecordingDriver()

    expect(isDriver(driver)).toBe(true)
    expect(isDriver({ ...driver })).toBe(true)
    expect(isDriver(Object.assign(() => {}, driver))).toBe(true)
  })

  it("rejects a value without a method of a driver, such as a database or a client", () => {
    const { driver } = createRecordingDriver()
    const { close: _, ...unclosable } = driver

    expect(isDriver(createDatabase({ driver }))).toBe(false)
    expect(isDriver(unclosable)).toBe(false)
    expect(isDriver({ ...driver, acquire: true })).toBe(false)
    expect(isDriver(null)).toBe(false)
    expect(isDriver(undefined)).toBe(false)
    expect(isDriver(() => {})).toBe(false)
  })
})
