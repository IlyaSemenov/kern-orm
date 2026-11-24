# Separate JSON types for the `jsonNull` marker

`json` and `jsonb` read a JSON `null` value as `null`, as they read `NULL`, and a query passes `null` as `NULL`, so a column of them does not tell the two apart, and `nullableAs` tells them only in results and, in the ORM, only without a shape.
`jsonWithJsonNull` and `jsonbWithJsonNull` are types of their own that return and take a top-level JSON `null` value as `jsonNull`, a symbol that the library exports, so that `null` among their values is only `NULL`:

```ts
import type { JsonNull } from "kern-orm"
import { jsonNull } from "kern-orm"
import * as t from "kern-orm/types"

type Payload = { url?: string }

const job = defineTable("job", {
  id: t.uuid.primaryKey().hasDefault(),
  payload: t.jsonbWithJsonNull.of<Payload | JsonNull>().nullable(), // Payload | JsonNull | null
})

await db.job.insert({ payload: jsonNull }) // a JSON null value
await db.job.where({ payload: null }) // IS NULL
```

The marker is not `null`, so the types of expressions, which tell `NULL` by `null` among the values, stay as they are, and `of`, `nullable`, `transform`, and `array` apply to these types as to any other.
Their values without a shape are `{}`, the TypeScript type of every value other than `null` and `undefined`, which includes the marker, and a shape of `of` has the marker when its values include it, such as `Payload | JsonNull`.
Only the marker writes a JSON `null` value: the types reject another value that JSON writes as a top-level `null`, such as `NaN`, which would be read back as a marker that its shape may not name.
The marker is a symbol of `Symbol.for`, so that an application that takes it from a copy of `kern-db` other than the one of its types passes and compares the same value at runtime.
In types, two versions of the declarations may declare different `unique symbol` types, so the `JsonNull` of a declared shape and the `jsonNull` that the code passes and compares must come from the same declarations.

It changed none of the 106 counts of the [type benchmarks](../../benchmarks/types/), since no generic signature changed.

The alternatives:

- A runtime option of `of`, such as `jsonb.of<Payload>({ nullAs: marker })`, would declare the shape and the marker in one call, and add the marker to the values by itself.
  But `of` narrows [only in types](narrowed-values.md) and returns the type itself, the option would have a meaning for the JSON types alone, and a marker without a shape would have no spelling.
- A method of the JSON types alone, `t.jsonb.withJsonNull()`, would read as `withOperators` and `withParameters` do and add no exports.
  But every type has one set of methods, which the types derived from a type keep, so the method would have to be called first, on a type built apart from the others.
- A helper for `transform`, such as `const markedJsonb = t.jsonb.transform(jsonNullAs(jsonNull))` and then `markedJsonb.of<Payload | JsonNull>()`, would need no type of its own.
  But it converts each value once more, and the application applies the helper once to each base JSON type that it uses.
- A marker that the application defines would let it choose the value.
  But the marker must be outside the JSON values, and `undefined` already stands for a column that an insert omits and an update keeps, so the choice is between symbols, at the cost of a type parameter for the marker.
- A marker object whose `toJSON` returns `null` would serialize as a JSON `null` value, while `JSON.stringify` leaves a symbol out of an object, writes it as `null` in an array, and returns `undefined` for it alone, and `structuredClone` throws for it.
  But TypeScript narrows both branches of `=== marker` only for a unit type, which an object type is not, and a result is read by that comparison.
  The application converts the marker where a result leaves it.
- The marker as the JSON `null` value of `json` and `jsonb` themselves would keep one pair of types.
  But it changes what existing columns return, to a symbol in code that expects `null`, and `nullableAs` of `jsonb` would no longer apply in the ORM.
- `json` and `jsonb` taking the marker when encoding, without returning it, would let a column of `nullableAs` write a JSON `null` value without SQL.
  But the same value would read as `null` and write as `jsonNull`.
- Markers only for writing and filtering, while results have `null` for both, as Prisma ORM has `JsonNull`, `DbNull`, and `AnyNull`, and SQLAlchemy `JSON.NULL` ([comparison](../../comparison/schemas.md#json-null-values-told-from-null)).
  But a record that a query returns does not tell which one it read.
- `null` as the JSON `null` value, with another value for `NULL`, would need no marker.
  It needs [nullability apart from the values](nullability-of-accepted-values.md) in types and expressions, which the [backlog](../../backlog/passing-a-value-as-null.md) keeps.
- Shorter names, `jsonWithNull` and `jsonbWithNull`.
  But `Null` in the names of the API, such as `nullable`, `nullableAs`, and `isNull`, stands for `NULL`, so `jsonbWithNull.nullable()` would read as one setting twice, and the type alone rejects `null`.
