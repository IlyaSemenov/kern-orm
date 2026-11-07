# Aggregates and groups

## Aggregates of distinct rows

An aggregate method after `distinct` aggregates the distinct rows of the selected fields, so `distinct().count()` is the number of the distinct rows.

- Orchid ORM, fails: it adds `DISTINCT` to any select list, so its `distinct().count()` compiles to `SELECT DISTINCT count(*)`, which counts every row ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/sql/to-sql.ts)).

## Grouping by a selected field

A string of `groupBy` names a column, a selected field is a key through the second parameter of its callback, and a query needs no selection to be grouped.

- Orchid ORM, differs: `group` takes a selected alias before a column and compiles it to a position, and it requires a selection in types ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/sql/to-sql.ts)).

## Aggregates of a group

A directly selected unfiltered aggregate in a group has the nullability of its argument; without grouping, aggregates other than counts also include `null` for empty input.

- Kysely, differs: it types `sum` and `avg` without `null` by default, and `min` and `max` by the type of their argument, and its documentation recommends adding `null` by hand ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/query-builder/function-module.ts#L216)).
- Orchid ORM, lacks: its documentation says `min`, `max`, `sum`, and `avg` return `null` without records and does not tell groups apart ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/aggregate.md#min)).
