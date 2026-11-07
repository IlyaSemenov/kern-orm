import { describe, expect, it } from "bun:test"

import { count, max, stringAgg, sum } from "../expression/aggregates"
import { FALSE, TRUE } from "../expression/constants"
import { coalesce } from "../expression/functions"
import { param, sql } from "../expression/sql"
import { defineHelper } from "../query/helper"
import { from } from "../query/select"
import { defineTable } from "../table/table"
import * as t from "../types"

const item = defineTable("item", {
  bucket: t.integer,
  value: t.integer,
  label: t.text,
})

const outerError = /refers only to enclosing queries; use an explicitly nullable sql expression/

describe("group aggregate ownership", () => {
  it("rejects an aggregate of an outer occurrence of the same table before or after grouping", () => {
    const before = from(item)
      .where(FALSE)
      .select(outer => ({
        groups: from(item)
          .select(() => ({
            total: sum(outer.value),
          }))
          .groupBy("bucket"),
      }))
    const after = from(item).select(outer => ({
      groups: from(item)
        .groupBy("bucket")
        .select(() => ({
          total: sum(outer.value),
        })),
    }))
    expect(() => before.toSQL()).toThrow(
      'An aggregate function of grouped field "total" refers only to enclosing queries',
    )
    expect(() => after.toSQL()).toThrow(outerError)
  })

  it("checks get, pluck, helpers, and converted or paginated group results", () => {
    const query = from(item).select(outer => {
      const total = defineHelper(item, query =>
        query.select(() => ({
          total: sum(outer.value),
        })),
      )
      const groups = from(item).groupBy("bucket")
      expect(() => groups.get(() => sum(outer.value)).toSQL()).toThrow(
        "An aggregate function of the grouped value refers only to enclosing queries",
      )
      expect(() => groups.pluck(() => max(outer.value)).toSQL()).toThrow(outerError)
      expect(() =>
        groups
          .use(total)
          .map(row => row.total)
          .toSQL(),
      ).toThrow(outerError)
      expect(() =>
        groups
          .use(total)
          .offset(1)
          .select(() => ({
            nested: from(item).count(),
          }))
          .toSQL(),
      ).toThrow(outerError)
      return {
        total: count(),
      }
    })
    expect(() => query.toSQL()).not.toThrow()
  })

  it("allows local and constant arguments, also through scalar subqueries", () => {
    const query = from(item)
      .groupBy("bucket")
      .select(local => ({
        total: sum(local.value),
        constant: sum(param(t.integer, 1)),
        independent: sum(from(item).count()),
        correlated: sum(
          from(item)
            .where(inner => inner.bucket.eq(local.bucket))
            .count(),
        ),
        throughSubquery: sum(from(item).get(() => local.value)),
      }))
    expect(() => query.toSQL()).not.toThrow()
  })

  it("finds outer references through a subquery without mistaking its own columns for local references", () => {
    const query = from(item).select(outer => ({
      groups: from(item)
        .groupBy("bucket")
        .select(() => ({
          total: sum(
            from(item)
              .where(inner => inner.bucket.eq(outer.bucket))
              .count(),
          ),
        })),
    }))
    expect(() => query.toSQL()).toThrow(outerError)
  })

  it("counts local references in the order of stringAgg when determining ownership", () => {
    const query = from(item)
      .groupBy("bucket")
      .select(outer => ({
        groups: from(item)
          .groupBy("bucket")
          .select(local => ({
            joined: stringAgg(outer.label, ",", { orderBy: local.value }),
          })),
      }))
    expect(() => query.toSQL()).not.toThrow()
  })

  it("allows counts, filters, functions of aggregates, and explicitly typed SQL without narrowing them", () => {
    const query = from(item)
      .where(FALSE)
      .select(outer => ({
        groups: from(item)
          .groupBy("bucket")
          .select(() => ({
            count: count(outer.value),
            filtered: sum(outer.value, { filter: TRUE }),
            fallback: coalesce(sum(outer.value), 0),
            fragment: sql(t.integer.nullable())`sum(${outer.value})`,
          })),
      }))
    expect(() => query.toSQL()).not.toThrow()
  })

  it("keeps the SQL semantics of ungrouped outer aggregates", () => {
    const query = from(item).select(outer => ({
      values: from(item).pluck(() => sum(outer.value)),
    }))
    expect(() => query.toSQL()).not.toThrow()
  })
})
