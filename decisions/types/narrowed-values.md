# Values narrowed in types by `of`

`of<T>()` of every type narrows the values that it returns and accepts to `T` only in TypeScript, such as to a union of strings that a `CHECK` constraint allows, to numbers of a `smallint`, or to the shape of JSON values, and returns the type itself at runtime:

```ts
type FieldType = "text" | "email" | "choice"

const field = defineTable("form_field", {
  type: t.text.of<FieldType>(),
  width: t.smallint.of<1 | 2>(),
  options: t.jsonb.of<{ choices: string[] }>(),
})
```

The alternatives:

- A list of the values, such as `t.text.oneOf(["text", "email", "choice"])`, gives the application the values at runtime from the same declaration, such as for validation or a form.
  Drizzle ORM infers a union from the values of `text({ enum })` ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/columns/text.ts)).
  A list also allows checking the values that queries read, which costs a call for each value of each row.
  A type covers a union that the application declares itself, also from a list of its own:

  ```ts
  const fieldTypes = ["text", "email", "choice"] as const

  const field = defineTable("form_field", {
    type: t.text.of<(typeof fieldTypes)[number]>(),
  })
  ```

- `of` of text and JSON types alone leaves out unions of numbers, such as of a `smallint` with a `CHECK`, and values of a type of their own, such as identifiers of `uuid`, while one method of every type costs the same instantiations in the [type benchmarks](../../benchmarks/types/).
