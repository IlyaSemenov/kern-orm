# Computed columns

Columns that a table defines as expressions over its other columns, which queries select, filter, and sort by their keys, such as the kind of an event that a key of its JSON details holds, and fields computed at runtime from selected columns, as `computed` and `computeAtRuntime` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/computed-columns.md)).

- Decide whether a table or a schema defines them, so that they can read relations, as a schema defines relations, such as the profit of a record from its related records.
- Inserts and updates reject them, as [generated columns](generated-columns.md); decide whether `select("*")` selects them.
- Fields computed at runtime could be [`map`](../architecture/queries.md#converting-results) of a query instead.
