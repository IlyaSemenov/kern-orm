# Types

Give each column a type from `kern-orm/types`: the type sets the PostgreSQL type of the column, the JavaScript values that queries return and accept, and the [operators](./queries/operators) of its expressions.
Import all types as a namespace, or individual types by name:

```ts
import * as t from "kern-orm/types"
import { text, uuid } from "kern-orm/types"
```

In a table definition, a type becomes a column; see [Columns](./tables#columns) for the attributes of columns, such as keys and defaults.

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
- `timestamptzPortable`, `timestamptzPortable.with(precision)`: the values of `timestamptz`, read with any session settings; see [Points in time on any connection](#points-in-time-on-any-connection).
- `timestamp`, `timestamp.with(precision)`: date and time without a time zone as an ISO 8601 `string`, such as `"2026-01-15T10:00:00.000000"`.
- `date`: `string`, such as `"2026-01-15"`.
- `time`, `time.with(precision)`: `string`, such as `"10:00:00.000000"`.
- `interval`: `string` in the PostgreSQL output format, such as `"1 day 02:00:00"`.
- `json`, `jsonb`: `unknown`; declare the shape of the values with [`of`](#narrowing-values), such as `jsonb.of<{ choices: string[] }>()`.
  PostgreSQL has no `=` for `json`, so its expressions have no `eq`, `ne`, or `in`.
  Store a missing value as `NULL` in a [`nullable`](#nullable-values) column rather than as a JSON `null` value.
  Queries pass `null` as `NULL`, and a JSON `null` value reads as `null` too, while `coalesce`, `isNull`, and `where` with `null` match only `NULL`.
- `jsonWithJsonNull`, `jsonbWithJsonNull`: `json` and `jsonb` values in which a top-level JSON `null` value is `jsonNull`, apart from `null` of `NULL`; see [JSON `null` values](#json-null-values).
- `inet`, `cidr`: `string`.
- `vector`, `vector.with(dimensions)`: `number[]`, for the `vector` type of the [pgvector](https://github.com/pgvector/pgvector) extension; sort and filter by its [distances](./queries/operators#vector-distances).
- `array(element)`: one-dimensional array of the element values, such as `array(text)`; the elements of a custom type must be separated by commas in PostgreSQL, as those of all built-in types are.
  An array has `eq`, `ne`, and `in` when its element type has SQL `=` from [`equalityOperators`](./custom-types#operators).
- `enum(name, values)`: one of `values`, for an existing PostgreSQL enum `name`.

Date and time strings have a fixed format, so comparing them as strings orders them chronologically.
kern-orm expects the default `DateStyle` (`ISO`) and `bytea_output` (`hex`) settings.

`timestamptz` decodes fastest in a session whose `TimeZone` is `UTC`, where its values have no offset to convert.
If the SQL of the application does not depend on the time zone of the session, such as through `now()::date` or `date_trunc('day', created_at)`, set `TimeZone` to `UTC` in the connection options of the client, as the settings below show for `DateStyle`.

:::: details Databases with other settings
If the database or the role sets another `DateStyle` or `bytea_output`, set the defaults in the connection options of the client, which take precedence:

::: code-group

```ts [postgres.js]
postgres(process.env.DATABASE_URL!, {
  connection: { DateStyle: "ISO", bytea_output: "hex" },
})
```

```ts [node-postgres]
new Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c DateStyle=ISO -c bytea_output=hex",
})
```

```ts [Bun SQL]
new SQL(process.env.DATABASE_URL!, {
  prepare: false,
  connection: { DateStyle: "ISO", bytea_output: "hex" },
})
```

:::

A library that runs on the connections of an application, whose settings it does not choose, can read points in time with [`timestamptzPortable`](#points-in-time-on-any-connection) instead, and `date`, `timestamp`, and `bytea` values by a [read expression](./custom-types#reading-values-by-an-expression) of a type of its own.
::::

::: details Years outside 1 to 9999
These years are written as in `Date.toISOString`: `+010000` for 10000, and `0000` for 1 BC, `-000001` for 2 BC, and so on.
Such strings do not sort chronologically.
:::

## Points in time on any connection

Code that runs on connections whose settings it does not choose, such as a library on the pool of an application, can give a `timestamptz` column the type `timestamptzPortable`.
It returns and accepts the strings of `timestamptz`, which queries read by an expression that does not depend on the `DateStyle` and `TimeZone` settings of the session.
Pass a string that one query returns to another, under any `DateStyle`, and it binds the same instant, with microseconds.

```ts
export const job = defineTable("job", {
  id: t.integer.primaryKey(),
  runAt: t.timestamptzPortable.columnName("run_at"),
})

// SELECT (to_jsonb("job"."run_at" AT TIME ZONE INTERVAL '00:00') #>> '{}') AS "runAt" FROM "job" AS "job" WHERE "job"."id" = $1
const runAt = await db.job.find(jobId).get("runAt")
// runAt: string, such as "2026-01-15T07:00:00.123456Z"
```

Queries select every value of the type that they return by the expression, also in related records, in the fields that a mutation returns, in [`columnsOf`](./queries/sql#rows-of-tables), and in a `sql` fragment of the type, such as `` sql(t.timestamptzPortable)`transaction_timestamp()` `` for the clock of the transaction.
They filter and sort by the value itself, which keeps the comparison of instants and the indexes of the column.

A statement of SQL text that lists such a field itself must select the expression, since `get(t.timestamptzPortable)` decodes the field that the statement selects; pass the value back with `param`:

```ts
import { param } from "kern-orm"

const runAt = await db.$query`
  SELECT (to_jsonb(run_at AT TIME ZONE INTERVAL '00:00') #>> '{}') FROM job WHERE id = ${jobId}
`.get(t.timestamptzPortable)

await db.$query`UPDATE job SET run_at = ${param(t.timestamptzPortable, runAt)} WHERE id = ${nextJobId}`
```

Use `timestamptz` wherever the application can set `DateStyle` to `ISO`: each value of `timestamptzPortable` costs PostgreSQL more to return.

## Nullable values

For values that can be `NULL`, use `.nullable()`, which adds `null` to the values of the type, in a column and in a query alike.
In an array, it applies to the level it is called on: `array(text.nullable())` allows `NULL` elements, and `array(text).nullable()` allows a `NULL` array.

## Narrowing values

To type a column whose values are a union, such as the type of a form field that a `CHECK` constraint limits, narrow its type with `of`:

```ts
type FieldType = "text" | "email" | "choice"

export const field = defineTable("form_field", {
  id: t.uuid.primaryKey().hasDefault(),
  type: t.text.of<FieldType>(),
})
```

Queries return these values and accept only them, such as in `where`, `eq`, `in`, and `insert`.
`of` also declares the shape of JSON values, such as `t.jsonb.of<{ choices: string[] }>()`.

The values are not validated at runtime, so constrain them in the database, such as with `CHECK (type IN ('text', 'email', 'choice'))`.
For a PostgreSQL enum, use `enum(name, values)` instead.

## Deriving types

To work with values in another representation, such as `Date` or `Decimal`, derive a type with `transform`; it keeps the SQL type, operators, and nullability.
`decode` receives the values of the type, and `encode` returns values that the type accepts; without `encode`, the new type accepts the same values as the type, such as a `Date` for `timestamptz`.
`decode` cannot return `null`: it stands for `NULL`, which [`nullable`](#nullable-values) adds.
An `encode` that takes `null`, also as `unknown`, makes the type nullable, since queries pass `null` as `NULL`.

Every method of a type returns a type that keeps the changes made before it and leaves the type that it is called on as it is, so a derived type can be shared and refined further where it is used, such as `decimal` below, or derived for a single column; only a type of [`nullableAs`](#null-read-as-undefined) takes no further `transform`, `of`, or `nullable`:

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

## JSON `null` values

A `json` or `jsonb` column reads a JSON `null` value as `null`, as it reads `NULL`, and queries pass `null` as `NULL`.
To tell them apart, define the column with `jsonbWithJsonNull`, or with `jsonWithJsonNull` for a `json` column: queries return and take a JSON `null` value as `jsonNull`, while `null` stays `NULL`:

```ts
import type { JsonNull } from "kern-orm"
import { jsonNull } from "kern-orm"
import * as t from "kern-orm/types"

type Payload = { url?: string | null }

export const job = defineTable("job", {
  id: t.uuid.primaryKey().hasDefault(),
  payload: t.jsonbWithJsonNull.of<Payload | JsonNull>().nullable(),
  source: t.jsonWithJsonNull.of<Payload | JsonNull>().nullable(),
})

await db.job.insert({ payload: jsonNull }) // a JSON null value
await db.job.insert({ payload: null }) // NULL

// ids of the jobs whose payload is a JSON null value
await db.job.where({ payload: jsonNull }).pluck("id")
// ids of the jobs whose payload is NULL
await db.job.where({ payload: null }).pluck("id")

const payload = await db.job.find(id).get("payload")
// payload: Payload | JsonNull | null
if (payload === jsonNull) {
  // a JSON null value
}
```

Include `JsonNull` in the shape that `of` declares, beside the other values of the column.
Queries return `jsonNull` wherever they return the column, also in related records and in the records of [`columnsOf`](./queries/sql#rows-of-tables), and take it wherever they take a value of the column, such as in `eq`, in `in`, and as a fallback of `coalesce`.

- Only a JSON `null` value that is the whole value of the column is `jsonNull`: a `null` inside a value, such as `{ url: null }`, stays `null`.
  Write `null` inside a value too: `jsonNull` there is lost, as `{ url: jsonNull }` is written as `{}`.
- Only `jsonNull` writes a JSON `null` value: these types reject another value that JSON writes as `null`, such as `NaN`.

PostgreSQL has no `=` for `json`, so a `json` column has no `eq`, `ne`, or `in`, and no object condition of a value, such as `where({ source: jsonNull })`.
Find its JSON `null` values with `json_typeof` in a [SQL fragment](./queries/filtering#sql-fragments):

```ts
import { sql } from "kern-orm"

// ids of the jobs whose source is a JSON null value
await db.job.where(job => sql`json_typeof(${job.source}) = 'null'`).pluck("id")
```

`jsonNull` is a symbol, which neither JSON nor structured cloning carries.
`JSON.stringify` leaves out a key whose value is `jsonNull`, writes `jsonNull` in an array as `null`, and returns `undefined` for `jsonNull` itself, and `structuredClone` and a message to a worker throw for a value that has it.
Convert it where a result leaves the application, to values that the receiver tells apart.
In a record sent as JSON, `null` for a JSON `null` value and `undefined` for `NULL` do, since JSON leaves out a key of `undefined`; convert them in [`map`](./queries/selecting#results-converted-in-code):

```ts
const jobs = await db.job.select("id", "payload").map(job => ({
  ...job,
  // null for a JSON null value, and no key in JSON for NULL
  payload: job.payload === jsonNull ? null : (job.payload ?? undefined),
}))
```

A value alone, such as of `get`, and the values of an array, such as of `pluck`, have no key to leave out: JSON writes `undefined` in an array as `null` too.
Convert them to values that JSON carries and that the column cannot hold, such as a string of your own for a column of objects.
For a column of any JSON value, wrap each value, such as in `["value", payload]`, `["json-null"]`, and `["sql-null"]`.

### `NULL` read as `undefined`

A `json` or `jsonb` column without a shape can read `NULL` as `undefined` instead, so that `null` in a result is a JSON `null` value.
Define it with `nullableAs` instead of `nullable`:

```ts
import * as t from "kern-orm/types"

export const job = defineTable("job", {
  id: t.uuid.primaryKey().hasDefault(),
  payload: t.jsonb.nullableAs(() => undefined),
})

const payloads = await db.job.pluck("payload")
// undefined for NULL, and null for a JSON null value
```

Queries return the value that the function of `nullableAs` returns for each `NULL` of the column, also in related records and in the records of [`columnsOf`](./queries/sql#rows-of-tables); the function must return it synchronously, since decoding does not wait for a Promise.
They pass `null` as `NULL`, as for every nullable column, and `undefined` keeps its meaning: an insert that omits the column gives it its default, and an update keeps it.
Pass a JSON `null` value as SQL:

```ts
import { sql } from "kern-orm"

const jsonNullValue = sql(t.jsonb)`'null'::jsonb`

await db.job.insert({ payload: payload === null ? jsonNullValue : payload })

// jobs whose payload is NULL
await db.job.where({ payload: null })
// jobs whose payload is a JSON null value
await db.job.where({ payload: jsonNullValue })
```

`get` of the column gives `undefined` both for `NULL` and, with `optional`, for a missing row.
To tell them apart, select the column in a record: `db.job.find(id).select("payload").optional()` gives `{ payload: undefined }` for `NULL` and `undefined` without the row.

`nullableAs` applies to `json` and `jsonb` without a shape of `of`, whose values include `null`.
Its values are final: `transform`, `of`, `nullable`, and `nullableAs` of the type that it creates throw, also where a shared type is refined for a column, such as `payload.of<Shape>()`.

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

await db.field
  .where(field => sql(t.text)`concat_ws(' ', ${field.label}, ${field.hint})`.ilike("%email%"))
  .select("id")

await db.form.where(form => sql`${form.id} = ANY(${param(t.array(t.uuid), ids)})`).select("id")
```

Pass a JSON value or an array to `sql` through `param`: a plain value becomes a parameter by itself only when it is a string, a number, a bigint, a Boolean, `null`, a `Date`, or a `Uint8Array`.

`param` casts the value to the type, so PostgreSQL applies the operators of the type even to a value on its own: `param(t.integer, 2).lt(10)` compares numbers rather than strings.
The cast omits type parameters, such as `$1::numeric` for `numeric.with(10, 2)`, so their precision, scale, or length do not constrain the value.

To pass a value once and read it in several places of a statement, create its `param(type, value)` once and use it at each place: the statement binds one parameter wherever it uses the same `param`.
Each call of `param` is a parameter of its own, and so is each place of a plain value and of a `param` of an expression with a plain value, which has no cast.

Use `param` to [select a constant](./queries/expressions#constant-values).

A column is not a type, so `sql` and `param` do not accept it.
