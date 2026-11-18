import { expect, it } from "bun:test"

import { describePostgres } from "../../../testing/postgres"
import { bindSchema } from "../../execution/db"
import { from } from "../../query/select"
import { defineSchema } from "../../schema/schema"
import { defineTable } from "../../table/table"
import { defineType } from "../../type/type"
import * as t from "../../types"
import { getType } from "../expression"
import { param, sql } from "../sql"

import { vectorOperators } from "./vector"

const document = defineTable("document", {
  embedding: t.vector.with(3),
  summary: t.vector.with(3),
})

const documents = from(document)

it.each([
  ["l2Distance", "<->"],
  ["negativeInnerProduct", "<#>"],
  ["cosineDistance", "<=>"],
  ["l1Distance", "<+>"],
] as const)("%s compiles %s with a parameter that the expression types", (operator, sign) => {
  expect(
    documents
      .select(columns => ({
        distance: columns.embedding[operator]([1, 2, 3]),
      }))
      .toSQL(),
  ).toMatchObject({
    text: `SELECT "document"."embedding" ${sign} $1 AS "distance" FROM "document" AS "document"`,
    parameters: ["[1,2,3]"],
  })
})

it("gives an expression of double precision", () => {
  expect(getType(sql(t.vector)`'[1]'`.l2Distance([1]))).toBe(t.doublePrecision)
})

it("encodes a plain operand with the type of the expression", () => {
  const halfvec = defineType({ sqlType: "halfvec" })
    .transform({
      decode: text => Float32Array.from(JSON.parse(text) as number[]),
      encode: (values: Float32Array) => `[${values.join(",")}]`,
    })
    .withOperators(vectorOperators)

  expect(
    documents
      .select(() => ({
        distance: param(halfvec, Float32Array.of(1, 2)).cosineDistance(Float32Array.of(0.5, 4)),
      }))
      .toSQL(),
  ).toMatchObject({
    text: 'SELECT $1::halfvec <=> $2 AS "distance" FROM "document" AS "document"',
    parameters: ["[1,2]", "[0.5,4]"],
  })
})

it("sorts by a distance and compares it without parentheses, and puts it in parentheses in arithmetic", () => {
  expect(
    documents
      .where(columns => columns.embedding.cosineDistance(columns.summary).lt(0.5))
      .orderBy(columns => columns.embedding.l2Distance([1, 2, 3]))
      .select(columns => ({
        similarity: columns.embedding.cosineDistance([1, 2, 3]).mul(-1).add(1),
      }))
      .toSQL().text,
  ).toBe(
    'SELECT ("document"."embedding" <=> $1) * $2 + $3 AS "similarity" FROM "document" AS "document" WHERE "document"."embedding" <=> "document"."summary" < $4 ORDER BY "document"."embedding" <-> $5',
  )
})

describePostgres("in PostgreSQL", ({ database, testTransaction, useTestFixture }) => {
  const document = defineTable("document", {
    id: t.integer.primaryKey(),
    embedding: t.vector.with(2),
    summary: t.vector.with(2).nullable(),
  })

  useTestFixture(() =>
    database.script(`
      CREATE EXTENSION vector;
      CREATE TABLE document (id integer PRIMARY KEY, embedding vector(2) NOT NULL, summary vector(2));
      INSERT INTO document VALUES (1, '[3,4]', '[3,4]'), (2, '[1,0]', NULL), (3, '[-1,-1]', '[1,1]');
    `),
  )

  const db = bindSchema(defineSchema({ document }), database)

  it("computes the distances of pgvector", async () => {
    const query = db.document.orderBy("id").select(columns => ({
      l2: columns.embedding.l2Distance([0, 0]),
      negativeInnerProduct: columns.embedding.negativeInnerProduct([1, 1]),
      cosine: columns.embedding.cosineDistance(columns.summary),
      l1: columns.embedding.l1Distance([0, 0]),
    }))

    expect(await testTransaction(async () => await query)).toEqual([
      { l2: 5, negativeInnerProduct: -7, cosine: 0, l1: 7 },
      { l2: 1, negativeInnerProduct: -1, cosine: null, l1: 1 },
      { l2: Math.SQRT2, negativeInnerProduct: 2, cosine: 2, l1: 2 },
    ])
  })

  it("finds the nearest vectors within a distance", async () => {
    // The distances to [-1,0] are about 5.66, 2, and 1, so the order of the rows is the reverse of the order of their insertion, and the condition keeps two of the three.
    const query = db.document
      .where(columns => columns.embedding.l2Distance([-1, 0]).lt(3))
      .orderBy(columns => columns.embedding.l2Distance([-1, 0]))
      .pluck("id")

    expect(await testTransaction(async () => await query)).toEqual([3, 2])
  })

  it("returns and matches vectors", async () => {
    const query = db.document.where({ embedding: [1, 0] }).select("embedding", "summary")

    expect(await testTransaction(async () => await query)).toEqual([
      { embedding: [1, 0], summary: null },
    ])
  })
})
