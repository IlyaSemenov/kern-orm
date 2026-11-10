# Queries repeated in a statement

An expression that holds a query is not one expression for PostgreSQL at two places of a statement, since the compiler gives each occurrence of a source its own alias: a key of a [query of groups](../architecture/queries.md#groups) that holds a query fails with `subquery uses ungrouped column` in `HAVING`, also beside an aggregate under `OR`, which `where` cannot replace, and in `ORDER BY` when the query does not select it, so only the position of its projection refers to it.

- A key and a sort key of a field that a later selection replaces, which hold a query, are lowered apart, so the key does not find the projection of the sort key; lowering one expression node to one node per query would give them one projection.
- A position refers to the selected projection, which `findValueProjection` finds by the same expression node or the same column.
