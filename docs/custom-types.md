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

For a type with PostgreSQL type parameters, such as the dimensions of `vector`, pass `withParameters` a function that formats the SQL type name with them; `with` then accepts the parameters:

```ts
// pgvector writes vectors as "[1,2,3]", which is also their JSON
const vector = defineType({ sqlType: "vector" })
  .transform({
    decode: text => JSON.parse(text) as number[],
    encode: (value: number[]) => JSON.stringify(value),
  })
  .withParameters((dimensions: number) => `vector(${dimensions})`)

export const document = defineTable("document", {
  embedding: vector.with(1536),
})
```

When the SQL type name alone constrains values, as `char` has length 1, `castType` names the type that [`param`](./types#types-in-queries) casts values to instead, such as `bpchar`.

## Operators

Add the operators that PostgreSQL has for the type with `withOperators`, reusing the operator sets of the built-in types:

- `equalityOperators`: `eq`, `ne`, and `in`, for a type with SQL `=`.
- `orderingOperators`: those of `equalityOperators`, and `lt`, `lte`, `gt`, and `gte`, for an ordered type.
- `textOperators`: `like` and `ilike`, for a type of strings.

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

const embedding = vector.withOperators({
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

The signature of a generic operator is an interface extending `OperatorSignature`, whose `method` takes the values of the expression as `this["T"]` and the values it accepts as `this["I"]`.
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

`ComparisonSignature`, `InSignature`, and `PatternSignature` are the signatures of the built-in operators, such as `lt`, `in`, and `like`.
The second type argument of `defineGenericOperator` restricts the types it can be added to, such as `AnyExpression<string | null>` for the types of strings.
