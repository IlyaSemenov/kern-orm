# Updating records with values of each

An update of several records, each with its own values, such as the positions and titles of the fields of a form from a request, in one statement, `UPDATE ... FROM (VALUES ...)` matched by a key, with the values encoded by the types of their columns rather than SQL types written by hand, as `updateMany` and `updateManyBy` of Orchid ORM 1.78.47 ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/update.md#updatemany)).

- The parameters of `VALUES` have no column to type them, so the statement casts them to the cast types of their columns, as `param` with a type does.
- Arrays of the values of each column, `unnest($1::uuid[], $2::text[])`, would keep the text of the statement the same for any number of records and their parameters within the limit, as [bulk inserts beyond the parameter limit](bulk-inserts-beyond-the-parameter-limit.md) weighs for inserts.
- Decide whether a record without a row rejects, as a query of `find` does, and whether records may set different columns.
