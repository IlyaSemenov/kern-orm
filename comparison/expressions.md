# Filters and expressions

## Empty groups of conditions

An empty group of conditions compiles to valid SQL beside the conditions around it.

- Orchid ORM, fails: `orWhere` with only `undefined` values left a dangling `OR` in invalid SQL ([orchid-orm#850](https://github.com/romeerez/orchid-orm/issues/850)).

## `IN` of an empty list

`in([])` is `FALSE`, and the other branch of an `OR` stays.

- Orchid ORM, fails: `whereNotIn`, `orWhereIn`, and `orWhereNotIn` of an empty list returned nothing, dropping the other branch ([orchid-orm#842](https://github.com/romeerez/orchid-orm/issues/842)).

## Operators of a query of one value

The operators of the value of a query are those of the expression that `expr` gives, such as `form.fields.count().expr().gt(3)`.

- Orchid ORM 1.78.37, differs: the operators are methods of the query, such as `q.sum("points").gt(0)` ([docs](https://github.com/romeerez/orchid-orm/blob/c4d62ea0e82f6d06c3b715fcf790113b2921a7ba/docs/src/guide/aggregate.md)).

## Identifiers in SQL fragments

`identifier` is a function of its own, as `sql` and `param` are.

- Drizzle ORM, differs: `sql.identifier` ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sql/sql.ts)).
- Slonik, differs: `sql.identifier` ([docs](https://github.com/gajus/slonik/blob/slonik@49.13.0/README.md#sqlidentifier)).
- Kysely, differs: `sql.id` ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/raw-builder/sql.ts#L271)).
