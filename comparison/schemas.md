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

## Types read by a SQL expression

A custom type declares `read`, the SQL expression that reads its values, such as `extract(epoch from value)` or `ST_AsGeoJSON(value)`, and decodes its result; queries select a returned value by it, also in packed nested rows and `RETURNING`, and filter, sort, and group by the value itself.

- MikroORM, differs: `convertToJSValueSQL` of a custom type returns the SQL that reads a column ([source](https://github.com/mikro-orm/mikro-orm/blob/v7.2.11/packages/core/src/types/Type.ts#L48-L53)), and the query builder writes it where it maps the column of a select list, of a condition, and of an order, so a condition compares and an order sorts by the result of the expression ([source](https://github.com/mikro-orm/mikro-orm/blob/v7.2.11/packages/sql/src/query/QueryBuilderHelper.ts#L238-L249)).
- Doctrine ORM 3.8.0 with Doctrine DBAL 4.6.0, same: `convertToPHPValueSQL` of a type ([source](https://github.com/doctrine/dbal/blob/4.6.0/src/Types/Type.php#L227-L241)) applies in the select list, and the columns of conditions and of an order stay as they are ([source](https://github.com/doctrine/orm/blob/3.8.0/src/Query/SqlWalker.php#L1317)).
- Drizzle ORM, lacks: `customType` has `fromDriver` and `toDriver`, and a select list selects the column as it is ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/columns/custom.ts#L185-L197), [drizzle-orm#554](https://github.com/drizzle-team/drizzle-orm/issues/554)).
  Drizzle ORM 1.0.0-rc.6 has `forJsonSelect`, which changes the SQL of a column inside JSON functions, such as of relational queries, and not in a select list ([source](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.6/drizzle-orm/src/pg-core/columns/custom.ts#L272-L325)).

## Column types defined apart from tables

A column type is a value of its own, such as of `defineType`, or of a built-in type with `transform`, which tables of any table factory import, also from a package.

- Orchid ORM, lacks: column types come from the table factory of a project, and a request for column types defined apart from it, to reuse them across projects, was closed as not planned, since they would not account for validation libraries, with a helper over `makeColumnTypes` suggested instead ([orchid-orm#405](https://github.com/romeerez/orchid-orm/issues/405)).

## `NULL` read as another value

A type of `nullableAs` returns the value of its function for `NULL` instead of `null`, such as `undefined`, in every result that the type decodes, and takes `null` as `NULL`.

- Orchid ORM, differs: `parseNull` of a column replaces a selected `null` with the value of its function ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/common-column-methods.md#parsenull), [source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/columns/column.utils.ts#L28-L30)).
  - On node-postgres, the driver parses a `jsonb` value to JavaScript before `parseNull`, so a JSON `null` value reads as the value of the function too, as `NULL` does ([source](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/adapters/node-postgres.ts#L58-L64)).
  - An insert of one record does not call `encode` of a column for `null`, which it writes as `NULL`, while `insertMany` calls it for `null` ([one record](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/basic-features/mutate/create.ts#L525-L532), [many](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/packages/pqb/src/query/basic-features/mutate/create.ts#L571-L577)).

## JSON `null` values told from `NULL`

`jsonWithJsonNull` and `jsonbWithJsonNull` return and take a top-level JSON `null` value as the marker `jsonNull`, and `NULL` as `null`, in results, values of mutations, and parameters, and `jsonbWithJsonNull` also in conditions that compare with a value, since PostgreSQL has no `=` for `json`; `json` and `jsonb` read both as `null` and pass `null` as `NULL`.

- Prisma ORM, differs: `Prisma.JsonNull` writes a JSON `null` value, and `Prisma.DbNull` writes `NULL` to a nullable field ([docs](https://github.com/prisma/web/blob/08b603bce80696c491917427507d201a4a98f6b4/apps/docs/content/docs/orm/v7/prisma-client/special-fields-and-types/working-with-json-fields.mdx#L747-L838), [values of a field](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/schema/src/build/enum_types.rs#L52-L67)); `equals` and `not` of a filter take both and `Prisma.AnyNull`, which matches either ([values of a filter](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/schema/src/build/enum_types.rs#L39-L49), [`equals`](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/schema/src/build/input_types/fields/field_filter_types.rs#L367-L379), [`not`](https://github.com/prisma/prisma-engines/blob/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8/query-compiler/schema/src/build/input_types/fields/field_filter_types.rs#L574-L585)).
  - The types of a `Json` field take no plain `null` ([source](https://github.com/prisma/prisma/blob/7.10.1/packages/client/src/runtime/core/types/exported/Json.ts#L32-L45)), and a `null` inside a value stays a JSON `null` value.
  - A result has `null` for both ([test](https://github.com/prisma/prisma/blob/7.10.1/packages/client/tests/functional/json-null-types/tests.ts#L11-L27)).
  - The markers are instances of classes, which the client recognizes by a brand of `Symbol.for` ([source](https://github.com/prisma/prisma/blob/7.10.1/packages/client-runtime-utils/src/nullTypes.ts#L14-L20)).
- SQLAlchemy, differs: the type binds `None` as a JSON `null` value, or as `NULL` with its `none_as_null=True`, while it always binds `JSON.NULL` as a JSON `null` value and `null()` as `NULL` ([source](https://github.com/sqlalchemy/sqlalchemy/blob/rel_2_1_9/lib/sqlalchemy/sql/sqltypes.py#L2950-L2974), [docs](https://github.com/sqlalchemy/sqlalchemy/blob/rel_2_1_9/lib/sqlalchemy/sql/sqltypes.py#L2556-L2584)).
  - A comparison takes `None` as `NULL` whatever the flag, and `JSON.NULL` as a JSON `null` value ([docs](https://github.com/sqlalchemy/sqlalchemy/blob/rel_2_1_9/lib/sqlalchemy/sql/sqltypes.py#L2682-L2693)).
  - A result has `None` for both ([source](https://github.com/sqlalchemy/sqlalchemy/blob/rel_2_1_9/lib/sqlalchemy/sql/sqltypes.py#L3007-L3012)).
- Django, differs: saving `None` writes `NULL` and `Value(None, JSONField())` a JSON `null` value ([source](https://github.com/django/django/blob/6.0.10/django/db/models/fields/json.py#L104-L118)), while `filter(data=None)` matches a JSON `null` value and `data__isnull=True` matches `NULL` ([source](https://github.com/django/django/blob/6.0.10/django/db/models/fields/json.py#L313-L320)); a result has `None` for both ([docs](https://github.com/django/django/blob/6.0.10/docs/topics/db/queries.txt#L1052-L1083)).
  Django 6.1 has `JSONNull()`, an expression that saves and matches a JSON `null` value ([release notes](https://github.com/django/django/blob/6.1/docs/releases/6.1.txt#L299-L303)), and deprecates `None` as a top-level JSON `null` value of a query, which is to compile to `IS NULL` ([release notes](https://github.com/django/django/blob/6.1/docs/releases/6.1.txt#L661-L666)).
- Drizzle ORM, lacks: a `null` value of a column skips `mapToDriverValue` of the column, so it is `NULL` ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sql/sql.ts#L238)), and a `null` of the driver skips `mapFromDriverValue` ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/utils.ts#L44)), after node-postgres parsed a JSON `null` value to `null`.
  The values of an insert wrap `sql.placeholder` in a parameter with the encoder of the column ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/query-builders/insert.ts#L91-L97)), which calls `mapToDriverValue` also for a `null` given for the placeholder ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/sql/sql.ts#L612-L628)), so a `jsonb` column, whose `mapToDriverValue` is `JSON.stringify` ([source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/pg-core/columns/jsonb.ts#L42-L44)), gets a JSON `null` value.
- Kysely, lacks: it passes parameters to the driver as they are ([source](https://github.com/kysely-org/kysely/blob/v0.29.8/src/dialect/postgres/postgres-driver.ts#L231-L234)), so `null` is `NULL`, and a JSON value is passed as the text of `JSON.stringify` ([docs](https://github.com/kysely-org/kysely/blob/v0.29.8/site/docs/recipes/0010-extending-kysely.md#L100-L101)); a result has what the driver parsed.
- Orchid ORM, lacks: `create` and `update` write `null` as `NULL`, and its docs give `` () => sql`'null'` `` for a JSON `null` value ([docs](https://github.com/romeerez/orchid-orm/blob/orchid-orm@1.78.47/docs/src/guide/columns-types.md#L486-L501)); a result has `null` for both.
  `where({ data: null })` is `IS NULL`, and `where({ data: { equals: null } })` is `nullif("data", 'null'::jsonb) IS NULL`, which matches both ([source](https://github.com/romeerez/orchid-orm/blob/orchid-orm@1.78.47/packages/pqb/src/columns/operators.ts#L704-L715)).
- TypeORM, lacks: the driver returns `null` before it serializes a JSON value, so it is `NULL` ([source](https://github.com/typeorm/typeorm/blob/1.1.3/packages/typeorm/src/driver/postgres/PostgresDriver.ts#L763)).
- MikroORM, lacks: `JsonType` returns `null` as it is, so it is `NULL`, and returns the value that the driver parsed ([source](https://github.com/mikro-orm/mikro-orm/blob/v7.2.11/packages/core/src/types/JsonType.ts#L7-L32)).
- Rails, lacks: the JSON type serializes `nil` as `NULL` and deserializes the JSON text `null` to `nil` ([source](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/type/json.rb#L14-L30)).
- Doctrine ORM with Doctrine DBAL 4.3.0, lacks: the JSON type writes `null` as `NULL` and reads both `NULL` and the JSON text `null` as `null` ([source](https://github.com/doctrine/dbal/blob/4.3.0/src/Types/JsonType.php#L40-L68)).
- knex, lacks: it passes bindings to the driver as they are ([source](https://github.com/knex/knex/blob/3.3.0/lib/client.js#L184-L186)).
- node-postgres, lacks: a `null` parameter is `NULL` ([source](https://github.com/brianc/node-postgres/blob/pg@8.23.1/packages/pg/lib/utils.js#L51-L55)), a `NULL` field skips the parser of its type ([source](https://github.com/brianc/node-postgres/blob/pg@8.23.1/packages/pg/lib/result.js#L68-L72)), and the parser of `json` and `jsonb` is `JSON.parse` ([source](https://github.com/brianc/node-pg-types/blob/v2.2.0/lib/textParsers.js#L202-L203)), so a result has `null` for both.
- Postgres.js, lacks: `sql.json(null)` sends `NULL`, since a `null` parameter skips its serializer ([source](https://github.com/porsager/postgres/blob/v4.1.0/src/connection.js#L571)).
- Slonik, differs: `sql.json(null)` and `sql.jsonb(null)` bind the text `null` with a cast, a JSON `null` value ([source](https://github.com/gajus/slonik/blob/slonik@49.13.0/packages/sql-tag/src/sqlFragmentFactories/createJsonSqlFragment.ts#L22-L25)).
- Bun SQL, differs: `sql.json(null)` is a JSON `null` value, and a plain `null` is `NULL` ([docs](https://github.com/oven-sh/bun/blob/bun-v1.4.4/docs/runtime/sql.mdx#L372-L377)).

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
