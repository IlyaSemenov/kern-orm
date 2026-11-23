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
