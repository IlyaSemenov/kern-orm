# Packed rows as positional arrays

A packed row is a positional JSON array of the values of the projections in their order, rather than an object with keys.

For the fields of each form:

```ts
const forms = await db.form.select("id").select(form => ({
  fields: form.fields.select("label", "position"),
}))
```

Packing builds each row with `json_build_array`, so PostgreSQL returns the fields of a form with two fields as:

```text
[["Email", "1"], ["Name", "2"]]
```

An object with keys, built with `json_build_object('label', ..., 'position', ...)`, repeats the keys in every row:

```text
[{"label" : "Email", "position" : "1"}, {"label" : "Name", "position" : "2"}]
```

- On records of 3 to 30 fields, PostgreSQL builds it 23 to 35% faster than an object with keys, and it is 40 to 48% smaller ([benchmark](../../benchmarks/suites/nested-transport.ts)).
