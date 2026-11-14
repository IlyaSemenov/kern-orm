# Mutations

## Defaults of columns in code

`default` of a column gives a value, an expression, or a function that returns one for each record, which an insert adds for a record that omits the column, each time it runs.

- Orchid ORM, differs: it takes a value or a `sql` fragment of `.default` as a default of the database, which its migrations declare, and only a callback as a default at runtime ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/common-column-methods.md#default)).
- Drizzle ORM, same: `$defaultFn` returns a value or a SQL fragment, which it calls for each record that omits the column when it builds the statement of the insert ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/dialect.ts#L541-L546)).

## Update and delete without a restriction

`update` and `delete` reject a query whose filters combine into `TRUE`, such as of `where({})`, unless `all` allows it, and a filter that matches no row, such as `in([])`, restricts the rows.

- Orchid ORM, fails: `delete` and `update` with `{ notIn: [] }` changed all records ([orchid-orm#847](https://github.com/romeerez/orchid-orm/issues/847)), and `delete` with `join` and a `where` without conditions produced invalid SQL ([orchid-orm#854](https://github.com/romeerez/orchid-orm/issues/854)).

## Update without values

`update` without a column to set, such as of the empty values of a PATCH, changes no row and resolves as the update would: a select of the rows of its filters gives their number, or the fields selected after it.

- Orchid ORM, differs: it turns such an update into a select of the rows, `SELECT count(*)` without selected fields, unless the table has its `updatedAt` timestamp, which the update sets even without values ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/update.md#empty-set)).

## Related records selected by a mutation

A mutation reads the related records that it selects in its own statement, atomic without a transaction or a savepoint.

- Orchid ORM, fails: it loaded them with a second query; for a mutation whose failure is caught, it left the savepoint across both open, and kept the changes of the mutation when an after hook between them threw ([orchid-orm#824](https://github.com/romeerez/orchid-orm/pull/824)).

## Inserts that skip the rows that conflict

`onConflict` of an insert takes the columns of a key of the table, or none for any key, and `doNothing` skips each row that conflicts on it, for which the insert returns no row.

- Orchid ORM, same: `onConflictDoNothing` takes the columns of a primary or unique key of the table definition, or none, and adds `undefined` to the result of one record ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/create.md#onconflictdonothing)).

## Inserts that update the records they conflict with

`onConflict` of an insert with `merge` or `update` updates the existing record of each row that conflicts on a key, as `DO UPDATE`, from the values of the row or of a callback that receives the existing row and the row proposed for insertion.

- Orchid ORM, same: `onConflict` with `merge` and `set` is `DO UPDATE` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/create.md#onconflict)).

## Upserts of the record of a key

`upsert` of a query of `find` or `findBy` inserts the record of the key with its values, or sets the values of the existing record, in one statement of `ON CONFLICT ... DO UPDATE`, so that concurrent upserts of a missing record do not reject with a unique violation.

- Orchid ORM, fails: `upsert` of a query of `find` or `findBy`, which takes the values of the update and of the insert apart, runs an `UPDATE`, and without a row a second statement that inserts the record unless the update in it finds one ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/create.md#upsert), [source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/sql/to-sql.ts#L196-L280)).
  So of two concurrent upserts of a missing record, one rejects with a unique violation, and its scopes, such as soft delete, filter the update but not the insert, so the upsert of a soft-deleted record by its key rejects with a unique violation too, unless the query includes the deleted records.

## Upserts of the row of a singleton table

`upsert` of the query of a singleton table inserts its row, or sets the values of the existing row, in one statement of `ON CONFLICT ((true)) DO UPDATE`, so that concurrent upserts of the missing row do not reject with a unique violation.

- Orchid ORM, fails: `all().take().upsert({ data, create })` over a unique index of `(true)` runs an `UPDATE`, and without a row a second statement that inserts it, as its `upsert` of a query of `find` does, so of two concurrent upserts of the missing row one rejects with a unique violation ([orchid-orm#752](https://github.com/romeerez/orchid-orm/issues/752), [source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/sql/to-sql.ts#L196-L280)).

## Inserts beyond the parameter limit

A mutation is one statement, and the compiler rejects a statement of more than 65535 parameters, so an insert of more values must be split.

- Orchid ORM, fails: it split such an insert into several statements in one savepoint, and a failure of a later one left the transaction aborted ([orchid-orm#811](https://github.com/romeerez/orchid-orm/pull/811)).

## Order of the rows of a bulk insert

`insertMany` does not promise the order of the rows it returns, so matching them to its records requires a key.

- Django, differs: `bulk_create` pairs the returned rows with its objects by position ([source](https://github.com/django/django/blob/6.0.10/django/db/models/query.py#L824)).
