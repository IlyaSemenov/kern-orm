# Upsert

What [`upsert`](../architecture/mutations.md#upserts) and [`onConflict`](../architecture/mutations.md#conflicts) of an insert do not cover:

- Telling an inserted row from an updated one, which `old` of [values before an update](values-before-an-update.md) gives on PostgreSQL 18.
- A partial unique index as the conflict target, such as of the records that are not soft-deleted, whose predicate `ON CONFLICT` requires, as the SQL target of `onConflict` of Orchid ORM does ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/create.md#onconflict)).
- A condition of the update, `DO UPDATE ... WHERE`, which makes rows `optional`; decide whether `where` before `upsert`, which `upsert` rejects, becomes it.
