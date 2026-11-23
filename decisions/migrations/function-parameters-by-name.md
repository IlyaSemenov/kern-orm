# Parameters of a function by name, with defaults as properties

`createFunction` takes the parameters of a function by name, as `createTable` takes columns: each its SQL type, or an object of its type with its mode and its SQL default.

```ts
createFunction(
  "enqueue",
  {
    task: "text",
    payload: { type: "jsonb", default: "null" },
    id: { mode: "out", type: "bigint" },
  },
  "LANGUAGE sql BEGIN ATOMIC … END",
)
```

```sql
CREATE FUNCTION "enqueue"(
  "task" text,
  "payload" jsonb DEFAULT null,
  OUT "id" bigint
) LANGUAGE sql BEGIN ATOMIC … END
```

Rollback drops the function by the modes and types of its parameters, which `DROP FUNCTION` takes without the defaults, and `replaceFunction` finds it by the types of its parameters other than `OUT`.
The helpers read no SQL of a parameter.

The design gives up a parameter of one SQL string, such as `"jsonb DEFAULT null"`, which reads as SQL whatever the parameter has: a parameter with a default or a mode is an object.

## A parameter of one SQL string

A parameter could be its SQL definition with its mode and default, such as `"jsonb DEFAULT null"` and `"OUT bigint"`, written after its quoted name.
The helpers would have to parse the SQL of PostgreSQL to leave out the default, which `DROP FUNCTION` rejects, and the `OUT` parameters, which do not identify the function.

## Dropping by the name alone

Rollback could run `DROP FUNCTION "enqueue"`, without parameters, which PostgreSQL accepts for a name of one function, and parameters could be SQL strings that the helpers do not read.
It fails for a name of several overloads, such as when the function overloads one that existed before its migration, which rollback of the migration finds too.
A later change to drop by the parameters would change the SQL of the helper, which applied migrations must keep.

## Defaults as an option

The defaults could be an option of their own, such as `defaults: { payload: "null" }`, with the types as the values of the parameters.
The default of a parameter would stand apart from it.
