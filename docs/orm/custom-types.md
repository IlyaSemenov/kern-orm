# Custom Types

To use a PostgreSQL type that kern-orm does not provide, define it by its SQL name with `defineType`.
Its values are the PostgreSQL text representations, and [`transform`](./types#deriving-types) converts them to other values.
Its expressions have only `isNull` until [`withOperators`](#operators) adds the operators that PostgreSQL has for the type.
Such a type is used like a built-in one, in tables and in queries.

```ts
import { defineTable, defineType, equalityOperators } from "kern-orm"

const ltree = defineType({ sqlType: "ltree" }).withOperators(equalityOperators)

export const category = defineTable("category", {
  path: ltree,
})
```

## Type parameters

For a type with PostgreSQL type parameters, such as the dimensions of `halfvec` of pgvector, pass `withParameters` a function that formats the SQL type name with them; `with` then accepts the parameters:

```ts
// pgvector writes vectors as "[1,2,3]", which is also their JSON
const halfvec = defineType({ sqlType: "halfvec" })
  .transform({
    decode: text => JSON.parse(text) as number[],
    encode: (value: number[]) => JSON.stringify(value),
  })
  .withParameters((dimensions: number) => `halfvec(${dimensions})`)

export const document = defineTable("document", {
  embedding: halfvec.with(1536),
})
```

When the SQL type name alone constrains values, as `char` has length 1, `castType` names the type that [`param`](./types#types-in-queries) casts values to instead, such as `bpchar`.

## Reading values by an expression

PostgreSQL returns the values of some types as text that depends on the session or is hard to decode: the text of `timestamptz` follows the `DateStyle` setting, and a `geometry` of PostGIS comes as hex-encoded binary.
To read the values of a type by a SQL expression instead, pass `read` a function that returns the SQL of the expression for the SQL of a value.
The type then decodes the result of the expression:

```ts
import { defineTable, defineType, orderingOperators } from "kern-orm"
import * as t from "kern-orm/types"

// Seconds since the epoch read the same with any DateStyle
const instant = defineType({
  sqlType: "timestamptz",
  read: value => `extract(epoch from ${value})`,
})
  .transform({
    decode: seconds => new Date(Math.round(Number(seconds) * 1000)),
    encode: (value: Date) => value.toISOString(),
  })
  .withOperators(orderingOperators)

export const job = defineTable("job", {
  id: t.integer.primaryKey(),
  runAt: instant,
})

// SELECT extract(epoch from "job"."runAt") AS "runAt" FROM "job" AS "job" ORDER BY "job"."runAt"
const times = await db.job.pluck("runAt").orderBy("runAt")
// times: Date[]
```

Queries select every value of the type that they return by the expression, also in related records and in the fields that a mutation returns.
They filter, sort, and group by the value itself, such as the column, so the expression changes only how a value is read.
[`columnsOf`](./queries/sql#rows-of-tables) selects such a column by the expression too, whereas a statement of SQL text that lists a field of such a type itself must select the expression, such as `extract(epoch from run_at) AS "runAt"`.

- The expression must be `NULL` for `NULL` and for no other value.
- Include the SQL text of the value exactly once in the returned expression.
- An aggregate other than a count reads its value by the expression of the type of its argument, in the PostgreSQL type of its result, such as the `numeric` average of `integer` values, so the expression must take that type.
  `sum` takes no `smallint` or `integer` type with `read`.
- A `sql` fragment of such a type must return a value of the PostgreSQL type, which the query reads by the expression.
- `array` takes no type with `read`, since the expression does not apply to the elements of an array.

## Operators

Add the operators that PostgreSQL has for the type with `withOperators`, reusing the operator sets of the built-in types:

- `equalityOperators`: `eq`, `ne`, and `in`, for a type with SQL `=`.
- `orderingOperators`: those of `equalityOperators`, and `lt`, `lte`, `gt`, and `gte`, for an ordered type.
- `textOperators`: `like`, `ilike`, `lower`, `upper`, `trim`, and `length`, for a type of strings.
- `arithmeticOperators`: `add`, `sub`, `mul`, and `div`, for a type of numbers; their results have the type of the expression.
- `exactArithmeticOperators`: those of `arithmeticOperators`, and `mod`, for a type of integers or exact numbers.
- `vectorOperators`: `l2Distance`, `negativeInnerProduct`, `cosineDistance`, and `l1Distance`, for a vector type of pgvector, such as `halfvec`.

```ts
import { defineType, orderingOperators, textOperators } from "kern-orm"

const citext = defineType({ sqlType: "citext" }).withOperators({
  ...orderingOperators,
  ...textOperators,
})
```

`like` and `ilike` send a string pattern as it is; to encode a pattern with a type, pass `param(type, pattern)`.

To add an operator of your own, include a function under the name of the operator in the object passed to `withOperators`.
The function receives the expression the operator is called on and the call arguments, and returns an expression.
An operator replaces an earlier one with the same name.
Build the result with a type, such as `sql(t.boolean)`, so that it can be selected.
`param` encodes a value interpolated into `sql` with the type of an expression.
Unlike `param` with a type, it adds no cast: PostgreSQL types the parameter by the expression it is used with.
This example adds a distance operator to `vector`:

```ts
import { defineTable, param, sql } from "kern-orm"
import * as t from "kern-orm/types"

const embedding = t.vector.withOperators({
  isWithin: (self, other: number[], distance: number) =>
    sql(t.boolean)`${self} <-> ${param(self, other)} < ${distance}`,
})

const document = defineTable("document", {
  id: t.uuid.primaryKey(),
  embedding: embedding.with(1536),
})

await db.document.where(document => document.embedding.isWithin(query, 0.3)).select("id")
```

An object passed to `where` matches a column with its `eq`, including one that `withOperators` replaced, and accepts the values that `eq` takes:

```ts
const caseless = t.text.withOperators({
  eq: (self, value: string) => sql(t.boolean)`lower(${self}) = lower(${value})`,
})

const account = defineTable("account", {
  email: caseless,
})

// lower(email) = lower($1)
await db.account.where({ email: "Alice@example.com" }).select("email")
```

## Generic operators

To define one operator for several types, such as `between` for numbers and dates, use `defineGenericOperator`.

Types derived with `transform` keep the operators, which work with the values of one of two types:

- An operator defined as a function works with the values of the type it was added to: `isWithin` takes `number[]` on every type derived from `embedding`.
- A generic operator works with the values of the expression it is called on, including those of a derived type, as the built-in operators do.

The signature of a generic operator is an interface extending `OperatorSignature`, whose `method` takes the values of the expression as `this["T"]` and the values it accepts as `this["I"]`, and can return an expression with the operators of the type of the expression, `this["O"]`.
`BooleanResult` makes the result `boolean | null` when the expression or an operand can be `NULL`, like the results of the built-in comparisons:

```ts
import type { BooleanResult, Expression, Operand, OperandValue, OperatorSignature } from "kern-orm"
import { defineGenericOperator, defineTable, param, sql } from "kern-orm"
import * as t from "kern-orm/types"

interface Between extends OperatorSignature {
  method: <Low extends Operand<this["T"], this["I"]>, High extends Operand<this["T"], this["I"]>>(
    low: Low,
    high: High,
  ) => Expression<BooleanResult<this["T"] | OperandValue<Low | High>>>
}

const between = defineGenericOperator<Between>(
  (self, low, high) => sql(t.boolean)`${self} BETWEEN ${param(self, low)} AND ${param(self, high)}`,
)

const event = defineTable("event", {
  rank: t.integer.withOperators({ between }),
  day: t.date.withOperators({ between }),
})

await db.event.where(event => event.rank.between(1, 10)).select("day")
await db.event.where(event => event.day.between("2026-01-01", "2026-01-31")).select("rank")
```

`ComparisonSignature`, `InSignature`, `PatternSignature`, and `ArithmeticSignature` are the signatures of the built-in operators, such as `lt`, `in`, `like`, and `add`.
The second type argument of `defineGenericOperator` restricts the types it can be added to, such as `AnyExpression<string | null>` for the types of strings.

## Types defined without the ORM

To give operators to a type defined without the ORM, such as in a package of a PostgreSQL extension that works with kern-db alone, pass it to `defineType` of `kern-orm` and add its operators with `withOperators`:

```ts
import { defineTable, defineType, equalityOperators } from "kern-orm"

import { halfvec as dbHalfvec } from "./db-types"

const halfvec = defineType(dbHalfvec).withOperators(equalityOperators)

export const document = defineTable("document", {
  embedding: halfvec.with(1536),
})
```

A type defined without the ORM has the same `transform`, `nullable`, `of`, and `withParameters`, but no operators.
Pass it to `defineType` before `nullableAs`, which the type of the ORM takes when its values include `null` apart from `NULL`, as for [JSON `null` values](./types#json-null-values).
To define one, import `defineType` from `kern-orm/db` and follow [Custom Types](../database/custom-types) of kern-db.
`kern-orm/db/types` exports such types for the built-in types, under the names of `kern-orm/types`.
