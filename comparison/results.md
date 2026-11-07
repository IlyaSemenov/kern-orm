# Converting results

## `map` of a `NULL` value

`map` converts each row that a query returns, so it calls its callback with `null` for a `NULL` value, such as of an aggregate without rows, and not for a missing row.

- Orchid ORM, differs: it does not call `map` for `null` of `sum` and `avg`, and `transform` converts it there ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/query-methods.md#map)).

## Methods after `transform`

Only another `transform` applies after `transform`, since each other method would change what its callback receives.

- Orchid ORM, same: its documentation requires the same of `transform` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/query-methods.md#transform)).
