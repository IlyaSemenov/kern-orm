# Tables and schemas

## Unions of column values

`of<T>()` of any type narrows the values that a column returns and accepts to `T`, such as a union of strings that a `CHECK` constraint allows, and types reject a `T` outside the values of the type.

- Orchid ORM, same: `narrowType` narrows the input, output, and query types of a column together ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/common-column-methods.md#narrowtype)).
- Drizzle ORM, lacks: `$type<T>()` takes any type, also one outside the values of the column ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/column-builder.ts)); `text({ enum })` infers a union from a list of the values ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/columns/text.ts)).

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

## Tables of one row

A table declared with `singleton: true` holds at most one row, which a query of the table reads, upserts, updates, and deletes without a key or `all`.

- Orchid ORM, lacks: a table of one row has no declaration of its own, so an application either passes a constant of a sentinel key column to every query, or reads the row of a unique index of `(true)` with `take` and changes it with `all`, whose reason needs a comment at every call, such as `all().take().upsert({ data, create })` ([orchid-orm#752](https://github.com/romeerez/orchid-orm/issues/752)).

## Checking tables against the database

`findTableMismatches` of `kern-orm/testing` finds the mismatches of the tables of a `Db` and its PostgreSQL schema, such as a missing column, a column of another type or nullability, a key without a unique index, and a required relation without a foreign key.

- Hibernate ORM, same: `validate` of `hibernate.hbm2ddl.auto` checks the mapped tables and columns with their types, and settings of 7.3 add the validation of indexes and unique keys ([docs](https://docs.hibernate.org/orm/7.4/javadocs/org/hibernate/cfg/SchemaToolingSettings.html)).
- Doctrine ORM, differs: `orm:validate-schema` fails when the schema that the mapping generates differs from the database in anything, as a schema diff, unless `--skip-sync` skips the check ([source](https://github.com/doctrine/orm/blob/3.5.0/src/Tools/Console/Command/ValidateSchemaCommand.php)).
- Alembic, differs: `alembic check` fails when autogenerate would generate operations from the differences of the models and the database; it compares server defaults only with `compare_server_default` ([docs](https://alembic.sqlalchemy.org/en/latest/autogenerate.html)).
