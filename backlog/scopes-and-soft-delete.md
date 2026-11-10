# Scopes and soft delete

Predicates that a table applies to its queries, such as excluding soft-deleted records, kept as the `scope` filters of a query, like `scopes` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/scopes.md)).

- Scope predicates are never operands of a user `OR`; test it ([orchid-orm#845](https://github.com/romeerez/orchid-orm/issues/845)).
- A scope that may exclude records ends the guarantee of the row as a filter does, so a query of a required relation to a table with such a scope starts with rows `nullable`.
- A scope applies to every query of its table, including queries of relations to it, nested queries, and queries of expressions, unless a query leaves it out by name, as `unscope` of Orchid ORM, such as to list deleted records.
- Decide whether a table or a schema declares scopes, as a schema declares relations.
- Soft delete builds on a scope: `delete` of a table with soft delete sets its column, such as `deletedAt` to `now()`, instead of deleting the rows, and a hard delete deletes them, as `softDelete`, `includeDeleted`, and `hardDelete` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/soft-delete.md)).
- A scope predicate does not restrict the rows of `update` and `delete`, which reject without another filter unless `all` allows it, as [architecture/mutations.md](../architecture/mutations.md#rows-to-change) requires and as Orchid ORM does for soft delete.
- A table interpolated into `sql` is its name, which no scope filters.
- Decide whether `upsert` of a table with a scope updates a record that the scope excludes, such as a soft-deleted one, which `ON CONFLICT` finds whatever the filters of the query.
