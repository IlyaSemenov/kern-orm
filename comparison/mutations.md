# Mutations

## Update and delete without a restriction

`update` and `delete` reject a query whose filters combine into `TRUE`, such as of `where({})`, unless `all` allows it, and a filter that matches no row, such as `in([])`, restricts the rows.

- Orchid ORM, fails: `delete` and `update` with `{ notIn: [] }` changed all records ([orchid-orm#847](https://github.com/romeerez/orchid-orm/issues/847)), and `delete` with `join` and a `where` without conditions produced invalid SQL ([orchid-orm#854](https://github.com/romeerez/orchid-orm/issues/854)).

## Related records selected by a mutation

A mutation reads the related records that it selects in its own statement, atomic without a transaction or a savepoint.

- Orchid ORM, fails: it loaded them with a second query; for a mutation whose failure is caught, it left the savepoint across both open, and kept the changes of the mutation when an after hook between them threw ([orchid-orm#824](https://github.com/romeerez/orchid-orm/pull/824)).

## Inserts that skip the rows that conflict

`onConflict` of an insert takes the columns of a key of the table, or none for any key, and `doNothing` skips each row that conflicts on it, for which the insert returns no row.

- Orchid ORM, same: `onConflictDoNothing` takes the columns of a primary or unique key of the table definition, or none, and adds `undefined` to the result of one record ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/create.md#onconflictdonothing)).

## Inserts that update the records they conflict with

`onConflict` of an insert with `merge` or `update` updates the existing record of each row that conflicts on a key, as `DO UPDATE`, from the values of the row or of a callback that receives the existing row and the row proposed for insertion.

- Orchid ORM, same: `onConflict` with `merge` and `set` is `DO UPDATE` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/create.md#onconflict)).

## Inserts beyond the parameter limit

A mutation is one statement, and the compiler rejects a statement of more than 65535 parameters, so an insert of more values must be split.

- Orchid ORM, fails: it split such an insert into several statements in one savepoint, and a failure of a later one left the transaction aborted ([orchid-orm#811](https://github.com/romeerez/orchid-orm/pull/811)).

## Order of the rows of a bulk insert

`insertMany` does not promise the order of the rows it returns, so matching them to its records requires a key.

- Django, differs: `bulk_create` pairs the returned rows with its objects by position ([source](https://github.com/django/django/blob/6.0.10/django/db/models/query.py#L824)).
