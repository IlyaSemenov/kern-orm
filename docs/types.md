# Types

Give each column a type from `kern-orm/types`: the type sets the PostgreSQL type of the column, the JavaScript values that queries return and accept, and the operators of its expressions.
Import all types as a namespace, or individual types by name:

```ts
import * as t from "kern-orm/types"
import { text, uuid } from "kern-orm/types"
```

## Columns

In a table definition, a type becomes a column:

```ts
import { defineTable } from "kern-orm"
import * as t from "kern-orm/types"

export const field = defineTable("form_field", {
  id: t.uuid.primaryKey(),
  formId: t.uuid.columnName("form_id"),
  label: t.text,
  hint: t.text.nullable(),
})
```

Column attributes set what belongs to the table:

- `.columnName("form_id")` sets the physical column name when it differs from the key.
- `.primaryKey()` marks the column as the primary key; a nullable type cannot be one.
- `.unique()` marks the column as a unique key.

For keys of several columns, see [Keys](./schemas#keys).

Changes of the type, such as `nullable` and `transform`, come before column attributes: `t.text.nullable().columnName("note")`.
Types and columns are immutable, so you can reuse them across tables.

Do not start column keys with `$`, which kern-orm reserves for its own members.

## Built-in types

Types are named after PostgreSQL types.
A value without an exact JavaScript counterpart is a string, so that no precision or time zone is lost.

Pass PostgreSQL type parameters with `with`, such as `varchar.with(255)` for `varchar(255)`.

- `smallint`, `integer`, `real`, `doublePrecision`: `number`.
- `bigint`: `bigint`; accepts `number` too.
- `numeric`, `numeric.with(precision, scale?)`: decimal `string`, such as `"12.50"`; accepts `number` and `bigint` too.
- `text`: `string`.
- `varchar`, `varchar.with(length)`: `string`; `varchar.with(length)` limits the length.
- `char`, `char.with(length)`: `string` padded with spaces to the length; `char` alone has length 1, as in PostgreSQL.
- `boolean`: `boolean`.
- `uuid`: `string`.
- `bytea`: `Uint8Array`.
- `timestamptz`, `timestamptz.with(precision)`: point in time as a UTC ISO 8601 `string` with microseconds, such as `"2026-01-15T07:00:00.123456Z"`; accepts `Date` too.
- `timestamp`, `timestamp.with(precision)`: date and time without a time zone as an ISO 8601 `string`, such as `"2026-01-15T10:00:00.000000"`.
- `date`: `string`, such as `"2026-01-15"`.
- `time`, `time.with(precision)`: `string`, such as `"10:00:00.000000"`.
- `interval`: `string` in the PostgreSQL output format, such as `"1 day 02:00:00"`.
- `json`, `jsonb`: `unknown`; `json.of<T>()` and `jsonb.of<T>()` declare the shape `T`, which is not validated at runtime.
  PostgreSQL has no `=` for `json`, so its expressions have no `eq`, `ne`, or `in`.
- `inet`, `cidr`: `string`.
- `array(element)`: one-dimensional array of the element values, such as `array(text)`; the elements of a custom type must be separated by commas in PostgreSQL, as those of all built-in types are.
  An array has `eq`, `ne`, and `in` when its element type has SQL `=` from [`equalityOperators`](./custom-types#operators).
- `enum(name, values)`: one of `values`, for an existing PostgreSQL enum `name`.

Date and time strings have a fixed format, so comparing them as strings orders them chronologically.
kern-orm expects the default `DateStyle` (`ISO`) and `bytea_output` (`hex`) settings.

::: details Years outside 1 to 9999
These years are written as in `Date.toISOString`: `+010000` for 10000, and `0000` for 1 BC, `-000001` for 2 BC, and so on.
Such strings do not sort chronologically.
:::

## Nullable values

For values that can be `NULL`, use `.nullable()`, which adds `null` to the values of the type, in a column and in a query alike.
In an array, it applies to the level it is called on: `array(text.nullable())` allows `NULL` elements, and `array(text).nullable()` allows a `NULL` array.

## Deriving types

To work with values in another representation, such as `Date` or `Decimal`, derive a type with `transform`; it keeps the SQL type, operators, and nullability.
`decode` receives the values of the type, and `encode` returns values that the type accepts; without `encode`, the new type accepts the same values as the type, such as a `Date` for `timestamptz`.

Every method of a type creates a new type that keeps the changes made before it, so a derived type can be shared and refined further where it is used, such as `decimal` below, or derived for a single column:

```ts
import * as t from "kern-orm/types"

// timestamptz values as Date, which keeps milliseconds and loses the microseconds;
// timestamptz accepts Date, so no encode is needed
const timestamptzDate = t.timestamptz.transform({ decode: value => new Date(value) })

// numeric values as Decimal, which keeps their precision
const decimal = t.numeric.transform({
  decode: value => new Decimal(value),
  encode: (value: Decimal) => value.toString(),
})

export const product = defineTable("product", {
  price: decimal.with(10, 2),
  weight: decimal.with(12, 3).nullable(),
  // a legacy column of comma-separated tags
  tags: t.text.transform({
    decode: value => value.split(","),
    encode: (value: string[]) => value.join(","),
  }),
  createdAt: timestamptzDate,
})
```

## Custom types

For a PostgreSQL type that kern-orm does not provide, such as `ltree` from an extension, define it with `defineType` and add its operators with `withOperators`; see [Custom types](./custom-types).

## Presets

To share custom types and column presets, create a project module that re-exports `kern-orm/types` and adds them:

```ts
// db/types.ts
import { defineType, orderingOperators, textOperators } from "kern-orm"
import { timestamptz, uuid } from "kern-orm/types"

export * from "kern-orm/types"

export const email = defineType({ sqlType: "citext" }).withOperators({
  ...orderingOperators,
  ...textOperators,
})

export const id = uuid.primaryKey()

export const timestamps = {
  createdAt: timestamptz.columnName("created_at"),
  updatedAt: timestamptz.columnName("updated_at"),
}
```

Tables then use built-in types and presets through one namespace:

```ts
import { defineTable } from "kern-orm"

import * as t from "./db/types"

export const user = defineTable("user", {
  id: t.id,
  email: t.email,
  name: t.text,
  ...t.timestamps,
})
```

## Types in queries

`sql(type)` gives a SQL fragment the operators of the type, and `param(type, value)` encodes a value interpolated into `sql` with the type:

```ts
import { param, sql } from "kern-orm"
import * as t from "kern-orm/types"

await db.form.where(form => sql(t.text)`lower(${form.name})`.like("draft%")).select("id")

await db.form.where(form => sql`${form.id} = ANY(${param(t.array(t.uuid), ids)})`).select("id")
```

`param` casts the value to the type, so PostgreSQL applies the operators of the type even to a value on its own: `param(t.integer, 2).lt(10)` compares numbers rather than strings.
The cast omits type parameters, such as `$1::numeric` for `numeric.with(10, 2)`, so their precision, scale, or length do not constrain the value.

A column is not a type, so `sql` and `param` do not accept it.
