# Types

::: info Using the ORM?
See [Types of the ORM](../orm/types): this page describes kern-db without the ORM.
:::

Pass a type from `kern-db/types` to `select`, `get`, or `pluck` to decode the values of a column, and to `param` to pass a value as a parameter: the type sets the PostgreSQL type and the JavaScript values that statements return and accept.

```ts
import { param } from "kern-db"
import * as t from "kern-db/types"

const fields =
  await database.query`SELECT id, label, hint FROM form_field WHERE form_id = ${formId}`.select({
    id: t.uuid,
    label: t.text,
    hint: t.text.nullable(),
  })
// fields: { id: string; label: string; hint: string | null }[]

await database.query`UPDATE form SET tags = ${param(t.array(t.text), tags)} WHERE id = ${formId}`
```

Import all types as a namespace, or individual types by name:

```ts
import * as t from "kern-db/types"
import { text, uuid } from "kern-db/types"
```

Types are immutable, so you can share them across statements and modules.

## Built-in types

Types are named after PostgreSQL types.
A value without an exact JavaScript counterpart is a string, so that no precision or time zone is lost.

- `smallint`, `integer`, `real`, `doublePrecision`: `number`.
- `bigint`: `bigint`; accepts `number` too.
- `numeric`: decimal `string`, such as `"12.50"`; accepts `number` and `bigint` too.
- `text`, `varchar`: `string`.
- `char`: `string` padded with spaces to the length.
- `boolean`: `boolean`.
- `uuid`: `string`.
- `bytea`: `Uint8Array`.
- `timestamptz`: point in time as a UTC ISO 8601 `string` with microseconds, such as `"2026-01-15T07:00:00.123456Z"`; accepts `Date` too.
- `timestamp`: date and time without a time zone as an ISO 8601 `string`, such as `"2026-01-15T10:00:00.000000"`.
- `date`: `string`, such as `"2026-01-15"`.
- `time`: `string`, such as `"10:00:00.000000"`.
- `interval`: `string` in the PostgreSQL output format, such as `"1 day 02:00:00"`.
- `json`, `jsonb`: `unknown`; declare the shape of the values with [`of`](#narrowing-values), such as `jsonb.of<{ choices: string[] }>()`.
  Store a missing value as `NULL` in a column that can be `NULL` rather than as a JSON `null` value.
  A parameter passes `null` as `NULL`, and a JSON `null` value reads as `null` too; to tell them apart, see [JSON `null` values](#json-null-values).
- `inet`, `cidr`: `string`.
- `array(element)`: one-dimensional array of the element values, such as `array(text)`; the elements of a custom type must be separated by commas in PostgreSQL, as those of all built-in types are.
- `enum(name, values)`: one of `values`, for an existing PostgreSQL enum `name`.

Date and time strings have a fixed format, so comparing them as strings orders them chronologically.
kern-db expects the default `DateStyle` (`ISO`) and `bytea_output` (`hex`) settings.

::: details Years outside 1 to 9999
These years are written as in `Date.toISOString`: `+010000` for 10000, and `0000` for 1 BC, `-000001` for 2 BC, and so on.
Such strings do not sort chronologically.
:::

## Nullable values

For a column that can be `NULL`, use `.nullable()`, which adds `null` to the values of the type: statements return `null` for `NULL`, and `param` passes `null` as `NULL`.

```ts
const hints = await database.query`SELECT hint FROM form_field`.pluck(t.text.nullable())
// hints: (string | null)[]
```

In an array, it applies to the level it is called on: `array(text.nullable())` allows `NULL` elements, and `array(text).nullable()` allows a `NULL` array.

## Narrowing values

To type a column whose values are a union, such as the type of a form field that a `CHECK` constraint limits, narrow its type with `of`:

```ts
type FieldType = "text" | "email" | "choice"

const fieldType = t.text.of<FieldType>()

const fieldTypes = await database.query`SELECT type FROM form_field`.pluck(fieldType)
// fieldTypes: FieldType[]

await database.query`UPDATE form_field SET type = ${param(fieldType, "email")} WHERE id = ${fieldId}`
```

Statements return these values, and `param` accepts only them.
`of` also declares the shape of JSON values, such as `t.jsonb.of<{ choices: string[] }>()`.

The values are not validated at runtime, so constrain them in the database, such as with `CHECK (type IN ('text', 'email', 'choice'))`.
For a PostgreSQL enum, use `enum(name, values)` instead.

## Deriving types

To work with values in another representation, such as `Date` or `Decimal`, derive a type with `transform`; it keeps the SQL type and nullability.
`decode` receives the values of the type, and `encode` returns values that the type accepts; without `encode`, the new type accepts the same values as the type, such as a `Date` for `timestamptz`.
`decode` cannot return `null`: it stands for `NULL`, which [`nullable`](#nullable-values) adds.
An `encode` that takes `null`, also as `unknown`, makes the type nullable, since a parameter passes `null` as `NULL`.

Every method of a type creates a new type that keeps the changes made before it, so a derived type can be shared and refined further where it is used, such as `decimal` below:

```ts
import * as t from "kern-db/types"

// timestamptz values as Date, which keeps milliseconds and loses the microseconds;
// timestamptz accepts Date, so no encode is needed
const timestamptzDate = t.timestamptz.transform({ decode: value => new Date(value) })

// numeric values as Decimal, which keeps their precision
const decimal = t.numeric.transform({
  decode: value => new Decimal(value),
  encode: (value: Decimal) => value.toString(),
})

const products =
  await database.query`SELECT price, weight, created_at AS "createdAt" FROM product`.select({
    price: decimal,
    weight: decimal.nullable(),
    createdAt: timestamptzDate,
  })
// products: { price: Decimal; weight: Decimal | null; createdAt: Date }[]

await database.query`UPDATE product SET price = ${param(decimal, price)} WHERE id = ${productId}`
```

## JSON `null` values

To tell a JSON `null` value from `NULL` in a `json` or `jsonb` column, where both read as `null`, derive a type that gives a JSON `null` value a value of your own, such as a symbol:

```ts
import { param } from "kern-db"
import * as t from "kern-db/types"

export const jsonNull = Symbol("JSON null")

type Payload = { url?: string }

// jsonb values in which a JSON null value is jsonNull, while NULL stays null
const payloadType = t.jsonb.of<Payload>().transform({
  // decode never receives NULL, so null here is a JSON null value
  decode: (value): Payload | typeof jsonNull => (value === null ? jsonNull : value),
  // jsonb takes no null, which a parameter passes as NULL, so a JSON null value needs a cast
  encode: (value: Payload | typeof jsonNull) => (value === jsonNull ? (null as never) : value),
})

const payloads = await database.query`SELECT payload FROM job`.pluck(payloadType.nullable())
// payloads: (Payload | typeof jsonNull | null)[]

await database.query`INSERT INTO job (payload) VALUES (${param(payloadType, jsonNull)})`
```

Statements return `jsonNull` for a JSON `null` value and `null` for `NULL`, and `param` takes them the same way.
Declare the shape of the values with `of`: without it, their type is `unknown`, which takes in the symbol, so it does not show `jsonNull`.

## Type parameters

Pass PostgreSQL type parameters with `with`, such as `t.varchar.with(255)` for `varchar(255)` or `t.numeric.with(10, 2)` for `numeric(10,2)`.
They change only the SQL type name of the type: it reads and writes the same values, and `param` casts a value to the type without them, such as `$1::numeric`, so that their precision, scale, or length do not constrain the value.

These types take parameters:

- `numeric.with(precision, scale?)`.
- `varchar.with(length)` and `char.with(length)`; `char` alone has length 1, as in PostgreSQL.
- `timestamptz.with(precision)`, `timestamp.with(precision)`, and `time.with(precision)`.

## Custom types

To use a PostgreSQL type that kern-db does not provide, such as `ltree` from an extension, define it by its SQL name with `defineType`:

```ts
import { defineType } from "kern-db"

export const ltree = defineType({ sqlType: "ltree" })

const path = await database.query`SELECT path FROM category WHERE id = ${categoryId}`.get(ltree)
// path: string
```

Its values are the PostgreSQL text representations, and [`transform`](#deriving-types) converts them to other values.
It has `nullable`, `of`, and `transform`, as the built-in types do.

For a type with PostgreSQL type parameters, such as the dimensions of `vector`, pass `withParameters` a function that formats the SQL type name with them; `with` then accepts the parameters, such as `vector.with(1536)`:

```ts
// pgvector writes vectors as "[1,2,3]", which is also their JSON
export const vector = defineType({ sqlType: "vector" })
  .transform({
    decode: text => JSON.parse(text) as number[],
    encode: (value: number[]) => JSON.stringify(value),
  })
  .withParameters((dimensions: number) => `vector(${dimensions})`)
```

When the SQL type name alone constrains values, as `char` has length 1, `castType` names the type that `param` casts values to instead, such as `bpchar`.

To use such a type in the tables and queries of the ORM, give it operators; see [Custom Types](../orm/custom-types#types-defined-without-the-orm) of the ORM.
