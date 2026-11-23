# Custom Types

::: info Using the ORM?
See [Custom Types of the ORM](../orm/custom-types): this page describes kern-db without the ORM.
:::

To use a PostgreSQL type that kern-db does not provide, such as `ltree` from an extension, define it by its SQL name with `defineType`:

```ts
import { defineType } from "kern-db"

export const ltree = defineType({ sqlType: "ltree" })

const path = await database.query`SELECT path FROM category WHERE id = ${categoryId}`.get(ltree)
// path: string
```

Its values are the PostgreSQL text representations, and [`transform`](./types#deriving-types) converts them to other values.
It has `nullable`, `of`, and `transform`, as the built-in types do.
To use such a type in the tables and queries of the ORM, pass it to `defineType` of `kern-orm`; see [Types defined without the ORM](../orm/custom-types#types-defined-without-the-orm).

## Type parameters

For a type with PostgreSQL type parameters, such as the dimensions of `halfvec` of pgvector, pass `withParameters` a function that formats the SQL type name with them; `with` then accepts the parameters, such as `halfvec.with(1536)`:

```ts
// pgvector writes vectors as "[1,2,3]", which is also their JSON
export const halfvec = defineType({ sqlType: "halfvec" })
  .transform({
    decode: text => JSON.parse(text) as number[],
    encode: (value: number[]) => JSON.stringify(value),
  })
  .withParameters((dimensions: number) => `halfvec(${dimensions})`)
```

When the SQL type name alone constrains values, as `char` has length 1, `castType` names the type that `param` casts values to instead, such as `bpchar`.

## Reading values by an expression

PostgreSQL returns the values of some types as text that depends on the session or is hard to decode: the text of `timestamptz` follows the `DateStyle` setting, and a `geometry` of PostGIS comes as hex-encoded binary.
To declare the SQL expression that reads the values of a type instead, pass `read` a function that returns the SQL of the expression for the SQL of a value.
The type then decodes the result of the expression, so a statement must select the value by it:

```ts
// Seconds since the epoch read the same with any DateStyle
export const instant = defineType({
  sqlType: "timestamptz",
  read: value => `extract(epoch from ${value})`,
}).transform({
  decode: seconds => new Date(Math.round(Number(seconds) * 1000)),
  encode: (value: Date) => value.toISOString(),
})

const runAt = await database.query`
  SELECT extract(epoch from run_at) FROM job WHERE id = ${jobId}
`.get(instant)
// runAt: Date
```

A query builder selects the expression itself wherever it returns a value of the type: kern-orm does in the queries of its tables, and [`createSqlColumns`](./query-builders#columns-of-your-tables) in the columns that it lists.

- The expression must be `NULL` for `NULL` and for no other value.
- Include the SQL text of the value exactly once in the returned expression.
- `array` takes no type with `read`, since the expression does not apply to the elements of an array.
