# Joins

Queries with joined tables:

- Decide which sources the column values of `where` resolve against, whether they can address joined tables, and how a callback receives the columns of joined tables.
- `SelectQuery` is typed by a single table and will need the shape of all query sources.
- A column of a source joined with `LEFT JOIN` is `NULL` without a match whatever its type, so its result type needs the nullability of the join.
- A [row lock](../architecture/queries.md#row-locks) of a query with joins applies to all its sources, and PostgreSQL rejects it for the nullable side of an outer join, so it will need the sources to lock, as `FOR UPDATE OF`.
- Sorting by a field of a related record, such as fields by the name of their form, is a [scalar subquery](../architecture/queries.md#sorting-and-pagination) of the relation in `orderBy`; benchmark a join against it, such as with an index of the order.
- A [query of groups](../architecture/queries.md#groups) as a joined source, such as of the rows with the largest sums.
