# Errors

## Telling a rejected statement by its condition

`isQueryError` tells a rejected statement by the name of its PostgreSQL condition, such as `unique_violation`, also for an error of another copy of kern-orm.

- Orchid ORM, differs: `isUnique` of its `QueryError` tells `23505` after `instanceof QueryError`, and a check of another condition compares `code` ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/errors.ts#L105-L107)).

## Continuing a transaction after a rejected statement

A statement that runs in a nested transaction rolls back to its savepoint when PostgreSQL rejects it, so that the enclosing transaction continues.

- Orchid ORM, differs: `catch` of a query runs it in a savepoint, and `catchUniqueError` also handles only a unique violation ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/error-handling.md#catchuniqueerror)).
