# Tables and schemas

## Reading PostgreSQL views

`defineView` describes the result columns of an existing ordinary or materialized view for read-only queries through the same schema entries as tables.
The SQL definition belongs to a migration.

- Orchid ORM 1.78.61, differs: its table factory supplies `defineView`, which applies the factory's naming convention.
  The descriptor can include the SQL body, and the application queries registered views through `db.$views`.
  Views are read-only by default; `readOnly: false` enables mutations on an ordinary view, and materialized views are always read-only ([published declarations](https://unpkg.com/orchid-orm@1.78.61/dist/index.d.ts)).
- Drizzle ORM, same for an existing view: `pgView(name, columns).existing()` describes its columns and tells Drizzle Kit to skip creating it; a view defined with `.as(query)` can instead infer the columns from the query ([docs](https://orm.drizzle.team/docs/views)).
- Prisma ORM, differs: its `views` preview feature exposes a read-only client model for a `view` block, and the developer supplies the SQL in a migration or creates the view separately.
  Prisma ORM has no schema support for materialized views ([docs](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/views)).

## Unions of column values

`of<T>()` of any type narrows the values that a column returns and accepts to `T`, such as a union of strings that a `CHECK` constraint allows, and types reject a `T` outside the values of the type.

- Orchid ORM, same: `narrowType` narrows the input, output, and query types of a column together ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/common-column-methods.md#narrowtype)).
- Drizzle ORM, lacks: `$type<T>()` takes any type, also one outside the values of the column ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/column-builder.ts)); `text({ enum })` infers a union from a list of the values ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/columns/text.ts)).

## Column naming conventions

`createTableFactory` takes any conversion of column keys to physical names, such as `toSnakeCase` or one of a legacy database.

- Orchid ORM, lacks: it has only its own `snakeCase`, and declined a function of names ([orchid-orm#197](https://github.com/romeerez/orchid-orm/issues/197)).

## Where the naming convention is set

A naming convention is an option of the definition of tables and views, `createTableFactory`, rather than of a database.

- Drizzle ORM, differs: `casing` is an option of `drizzle` ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/utils.ts)), and its documentation describes the builder `snakeCase.table` ([docs](https://orm.drizzle.team/docs/sql-schema-declaration#camel-and-snake-casing)).

## Snake case of runs of capital letters

`toSnakeCase` takes a run of capital letters for one word, such as `user_id` of `userID`, `json_data` of `JSONData`, and `user_ids` of `userIDs`.

- Orchid ORM, differs: it puts `_` before each capital letter, `i_d` of `ID` and `user_i_d` of `userID`, so a table moved from it with such a key requires `columnName` ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/utils.ts)).
- Drizzle ORM, differs: `user_i_ds` of `userIDs` and `ap_is` of `APIs` ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/casing.ts)).
- Kysely with its defaults, differs: `jsondata` of `JSONData` and `parse_htmldoc` of `parseHTMLDoc` ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/plugin/camel-case/camel-case.ts)).

## PostgreSQL schemas chosen at runtime

`bindSchema` takes a function of the PostgreSQL schema, which a `Db` calls for each statement, so one `db` serves the schema of each request, such as of its tenant.

- Drizzle ORM, lacks: a table belongs to the schema of its definition, with no override at runtime ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/schema.ts#L9-L24)), and dynamic schemas were requested in [drizzle-orm#423](https://github.com/drizzle-team/drizzle-orm/issues/423) and [drizzle-orm#1807](https://github.com/drizzle-team/drizzle-orm/issues/1807).
- Kysely, differs: `withSchema` gives an instance whose unqualified tables are in the schema, and the shared tables are qualified in the types of the database ([docs](https://github.com/kysely-org/kysely/blob/v0.29.8/site/docs/recipes/0007-schemas.md), [source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/kysely.ts#L478)).
- Prisma ORM, lacks: a model with `@@schema` belongs to that schema ([docs](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/multi-schema)), and a model without it to the default schema of the client, which the `schema` option of `PrismaPg` sets, so a schema per tenant requires a client per schema ([source](https://github.com/prisma/prisma/blob/7.10.1/packages/adapter-pg/src/pg.ts#L171-L173)), and schemas per tenant were requested in [prisma#12420](https://github.com/prisma/prisma/issues/12420).
- Orchid ORM, same: the `schema` option of `orchidORM` takes a function, which it calls for every query and subquery ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/orm-setup.md#global-db-schema)).

## Tables of one row

A table declared with `singleton: true` holds at most one row, which a query of the table reads, upserts, updates, and deletes without a key or `all`.

- Orchid ORM, lacks: a table of one row has no declaration of its own, so an application either passes a constant of a sentinel key column to every query, or reads the row of a unique index of `(true)` with `take` and changes it with `all`, whose reason needs a comment at every call, such as `all().take().upsert({ data, create })` ([orchid-orm#752](https://github.com/romeerez/orchid-orm/issues/752)).

## Checking tables against the database

`findTableMismatches` of `kern-orm/testing` finds the mismatches of the tables of a `Db` and its PostgreSQL schema, such as a missing column, a column of another type or nullability, a key without a unique index, and a required relation without a foreign key.

- Hibernate ORM, same: `validate` of `hibernate.hbm2ddl.auto` checks the mapped tables and columns with their types, and settings of 7.3 add the validation of indexes and unique keys ([docs](https://docs.hibernate.org/orm/7.4/javadocs/org/hibernate/cfg/SchemaToolingSettings.html)).
- Doctrine ORM, differs: `orm:validate-schema` fails when the schema that the mapping generates differs from the database in anything, as a schema diff, unless `--skip-sync` skips the check ([source](https://github.com/doctrine/orm/blob/3.5.0/src/Tools/Console/Command/ValidateSchemaCommand.php)).
- Prisma ORM, differs: `prisma migrate diff` with `--exit-code` fails when the structure of the database differs from the schema of its models in anything that it supports, as a schema diff ([docs](https://www.prisma.io/docs/cli/v7/migrate/diff)).
- Kysely, differs: kysely-codegen generates TypeScript types from the database, and its `--verify` fails when the generated file is out of date ([docs](https://github.com/RobinBlomberg/kysely-codegen/blob/0.20.0/README.md)).
- Drizzle ORM, lacks: `drizzle-kit check` checks the files of its migrations, not the database ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-kit/src/cli/commands/check.ts#L4-L17)).
- Alembic, differs: `alembic check` fails when autogenerate would generate operations from the differences of the models and the database; it compares server defaults only with `compare_server_default` ([docs](https://alembic.sqlalchemy.org/en/latest/autogenerate.html)).
