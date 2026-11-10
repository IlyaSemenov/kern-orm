# Columns of a violated unique constraint

The keys of the columns of a violated unique constraint, such as to tell users which field is taken without naming the constraint.
Orchid ORM 1.78.47 gives them as `columns` of its `QueryError`, which it reads from `detail` of the error and maps to the keys of the table ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/error-handling.md#database-error)).

- A driver creates `QueryError` without the query, so the keys need the query that PostgreSQL rejected, such as at its `await`.
- Decide whether to read the columns from `detail`, which PostgreSQL translates by `lc_messages`, or from the catalog by `constraint`.
