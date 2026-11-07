# Tables and schemas

## Column naming conventions

`createTableFactory` takes any conversion of column keys to physical names, such as `toSnakeCase` or one of a legacy database.

- Orchid ORM, lacks: it has only its own `snakeCase`, and declined a function of names ([orchid-orm#197](https://github.com/romeerez/orchid-orm/issues/197)).

## Where the naming convention is set

A naming convention is an option of the definition of tables, `createTableFactory`, rather than of a database.

- Drizzle ORM, differs: `casing` is an option of `drizzle` ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/utils.ts)), and its documentation describes the builder `snakeCase.table` ([docs](https://orm.drizzle.team/docs/sql-schema-declaration#camel-and-snake-casing)).

## Snake case of runs of capital letters

`toSnakeCase` takes a run of capital letters for one word, such as `user_id` of `userID`, `json_data` of `JSONData`, and `user_ids` of `userIDs`.

- Orchid ORM, differs: it puts `_` before each capital letter, `i_d` of `ID` and `user_i_d` of `userID`, so a table moved from it with such a key requires `columnName` ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/utils.ts)).
- Drizzle ORM, differs: `user_i_ds` of `userIDs` and `ap_is` of `APIs` ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/casing.ts)).
- Kysely with its defaults, differs: `jsondata` of `JSONData` and `parse_htmldoc` of `parseHTMLDoc` ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/plugin/camel-case/camel-case.ts)).
