# Read-only view descriptors

`defineView` describes the columns of an existing view and exposes it through the same schema entries and select queries as a table.
A separate descriptor lets mutation methods require a writable table even after a query gains filters or passes through a helper.

Using `defineTable` for a view can express a key guaranteed by its SQL and allows writes to a view that PostgreSQL makes updatable.
It also accepts a mutation of an aggregate view that can only fail when the statement executes.
An application can choose `defineTable` when it needs these capabilities and can guarantee the declared keys.

An alternative is a read-only option on a table descriptor, which would retain key-based reads while disabling mutations.
Orchid ORM 1.78.61 exposes a `readOnly` option on tables and views ([comparison](../../comparison/schemas.md#reading-postgresql-views)).
A separate view descriptor also lets the schema check require an ordinary or materialized view under its name.
