import { describe, expect, test } from "bun:test"

import { findIntervalRank, findMedian, findMedianInterval } from "./statistics"

describe("findMedian", () => {
  test("takes the middle value", () => {
    expect(findMedian([3, 1, 2])).toBe(2)
  })

  test("takes the upper of the two middle values of an even number", () => {
    expect(findMedian([4, 1, 3, 2])).toBe(3)
  })
})

describe("findIntervalRank", () => {
  // Coverage 1 − 2 P(Binomial(n, ½) < rank), from the exact binomial coefficients.
  test.each([
    { count: 1, rank: 1, coverage: 0 },
    { count: 5, rank: 1, coverage: 1 - 2 / 32 },
    { count: 6, rank: 1, coverage: 1 - 2 / 64 },
    { count: 10, rank: 2, coverage: 1 - (2 * (1 + 10)) / 1024 },
    { count: 20, rank: 6, coverage: 1 - (2 * (1 + 20 + 190 + 1140 + 4845 + 15504)) / 2 ** 20 },
  ])("takes the narrowest interval of $count values", ({ count, rank, coverage }) => {
    const interval = findIntervalRank(count, 0.95)
    expect(interval.rank).toBe(rank)
    expect(interval.coverage).toBeCloseTo(coverage, 12)
  })

  test("does not overflow for many values", () => {
    const interval = findIntervalRank(1024, 0.95)
    expect(interval.rank).toBe(481)
    expect(interval.coverage).toBeCloseTo(0.951071, 6)
  })
})

describe("findMedianInterval", () => {
  test("takes the order statistics of the rank from unsorted values", () => {
    const interval = findMedianInterval([5, 1, 3, 2, 4, 9, 8, 7, 6, 10], 0.95)
    expect([interval.low, interval.high]).toEqual([2, 9])
    expect(interval.coverage).toBeCloseTo(1 - (2 * (1 + 10)) / 1024, 12)
  })

  test("takes the range of too few values for the confidence", () => {
    const interval = findMedianInterval([1.2, 0.9, 1.1], 0.95)
    expect([interval.low, interval.high]).toEqual([0.9, 1.2])
    expect(interval.coverage).toBeCloseTo(1 - 2 / 8, 12)
  })
})
