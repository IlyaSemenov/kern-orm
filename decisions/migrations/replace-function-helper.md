# `replaceFunction` as a helper of its own

`replaceFunction` takes the definition of a function before and after the change, as `replaceView` takes the queries, and its rollback restores the previous definition:

```ts
replaceFunction(
  "add",
  { a: "integer", b: "integer" },
  "RETURNS integer LANGUAGE sql RETURN a + b",
  "RETURNS integer LANGUAGE sql RETURN b + a",
)
```

The design gives up one helper for both: a migration that replaces a function cannot copy the call of `createFunction` and add an option.

## An option of `createFunction`

`createFunction` could take `replace: true`, as that of node-pg-migrate does, and build `CREATE OR REPLACE FUNCTION`.
Its rollback would drop the function, as node-pg-migrate does, rather than restore the definition that the migration replaced, which the call does not give.
An option of the previous definition, such as `replaces: "LANGUAGE sql RETURN a + b"`, would give it, under a name that says that the helper creates.

`replaceFunction` has no option of rollback, unlike `replaceView`: both directions keep the parameters and the return type, so PostgreSQL always replaces back what it replaced.
