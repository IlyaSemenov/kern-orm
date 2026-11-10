# Scalar fragments of kern-orm in pages after an offset

A page after an offset keeps the nested queries on its table when a nested query holds a SQL fragment that refers to a column of the table, also through a query nested in the fragment, as [architecture/sql.md](../architecture/sql.md#nested-rows) states, since a fragment may aggregate the rows of the query.
Fragments that kern-orm builds are known to be scalar, such as the `coalesce` of the fallbacks of an aggregate in `form.fields.max("id").coalesce(form.id)` and the [functions of expressions](../architecture/types.md#functions-of-expressions), yet they keep the page on its table too.

- Mark such fragments, such as by a flag of a raw node or a node kind of a function call, so that the check skips them while still walking their operands, which may hold a fragment of a user or an aggregate.
- Research first which fragments refer to the columns of a parent row: the fallbacks of aggregates, and possibly generic operators and the operators of custom types.
- Aggregates of a nested query whose arguments read both its source and a column of the table also keep the page on its table; telling them apart needs the sources of the query that holds them.
