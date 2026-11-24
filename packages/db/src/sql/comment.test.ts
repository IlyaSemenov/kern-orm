import { describe, expect, it } from "bun:test"

import { getThrownError } from "@kern-orm/test-harness/errors"

import { addComment, createComment } from "./comment"

describe("createComment", () => {
  it("takes a label that stays inside the comment, also one that ends with `*`, `/`, or `-`", () => {
    for (const label of ["forms:claim", "", "a*", "a/", "a-", "a $1 ?", "line\nbreak"]) {
      expect(createComment(label)).toBe(label)
    }
  })

  it("takes null, which removes the comment", () => {
    expect(createComment(null)).toBeUndefined()
  })

  it("rejects the start and the end of a block comment, and a NUL character", () => {
    // TypeORM removes "*/" in one pass, so "**//" gives "*/", and keeps "/*": https://github.com/typeorm/typeorm/blob/1.1.3/packages/typeorm/src/query-builder/QueryBuilder.ts#L841-L852
    expect(getThrownError(() => createComment("a */ b"))).toEqual(
      new TypeError('comment cannot contain "/*" or "*/": "a */ b"'),
    )
    expect(getThrownError(() => createComment("a /* b"))).toEqual(
      new TypeError('comment cannot contain "/*" or "*/": "a /* b"'),
    )
    expect(getThrownError(() => createComment("a\0b"))).toEqual(
      new TypeError("comment cannot contain a NUL character"),
    )
  })

  it("rejects a value other than a string or null, such as undefined or an array", () => {
    for (const label of [undefined, ["*/"], 1]) {
      expect(getThrownError(() => createComment(label))).toEqual(
        new TypeError("comment takes a string, or null to remove the comment"),
      )
    }
  })
})

describe("addComment", () => {
  it("starts the text with the label in a block comment, or leaves the text without a label", () => {
    expect(addComment("SELECT 1", "forms:list")).toBe("/* forms:list */ SELECT 1")
    expect(addComment("SELECT 1", "a*")).toBe("/* a* */ SELECT 1")
    expect(addComment("SELECT 1", undefined)).toBe("SELECT 1")
  })
})
