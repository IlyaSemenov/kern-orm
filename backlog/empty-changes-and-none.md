# Empty changes and `none()`

An `update` without values, an `upsert` without values, and an `insertMany` without records reject, as [values](../architecture/mutations.md#values) and [upserts](../architecture/mutations.md#upserts) of architecture/mutations.md state.
Two independent goals:

1. Take them as changing nothing, so that code that passes the values of a request, such as of a PATCH, needs no check such as `if (Object.keys(values).length > 0)` before `update`.
   - An `update` without values changes no row, and with selected fields selects them from the rows it would change, so that a query of `find` still checks its record.
     Orchid ORM 1.78.47 turns it into a select of the rows, `SELECT count(*)` without selected fields ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/update.md#empty-set)).
   - An `upsert` without values, such as of the empty values of a PATCH, changes no value of an existing record: after it, the record of the key exists and is returned, and a missing record is inserted with its defaults.
     - An update of the key, `ON CONFLICT (key) DO UPDATE SET <column of the key> = EXCLUDED.<column of the key>`, returns the record atomically in every case, but updates an existing row physically: it fires `UPDATE` triggers, such as of `updated_at`, locks the row, and writes a new version of it.
       The upsert of the row of a [singleton table](../architecture/queries.md#queries-of-a-singleton-table) has no column of a key to set this way.
     - A select after `DO NOTHING`, `WITH inserted AS (INSERT ... ON CONFLICT DO NOTHING RETURNING ...) SELECT ... FROM inserted UNION ALL SELECT ... FROM <table> WHERE <key> AND NOT EXISTS (SELECT FROM inserted)`, leaves an existing row untouched, but its `SELECT` misses a record that a concurrent transaction inserted after the statement started, so it returns no row and rejects with `NotFoundError`.
     - Orchid ORM 1.78.47 turns `upsert` without the values of the update into `orCreate`: a `SELECT`, and then an `INSERT ... WHERE NOT EXISTS` in a second statement, which rejects with a unique violation when a concurrent transaction inserts the record between them ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/basic-features/mutate/upsert.ts#L47-L66)).
   - An `insertMany` without records changes no row: the number `0`, or an empty array of the selected fields.
   - Decide what an `update` or an `upsert` without values and without selected fields resolves to, such as `0` without a statement, whereas a mutation of rows `one` rejects with `NotFoundError` without a row, and whether a query of `find` then checks its record.
2. Skip the statement when its result is known without the database: a query of `none()`, a filter of `FALSE`, such as of `in([])`, or an `insertMany` without records resolves to no rows without a roundtrip.
   - Orchid ORM 1.78.47 resolves a query of `whereIn` of an empty list without querying the database ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/where.md#wherein)), and code that filters by a list from a request relies on it.
   - Decide what `toSQL` and `$compile` give for a query without a statement.
