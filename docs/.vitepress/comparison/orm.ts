// The matrix of docs/orm/comparison.md: kern-orm against other TypeScript ORMs and query builders for PostgreSQL.
// Each status of another project rests on a record of comparison/, which the row links, and the cell links its source.

import { defineMatrix } from "vitepress-comparison"

import { version } from "../../../packages/orm/package.json"

import { backlog, research } from "./links"

const drizzle = "https://github.com/drizzle-team/drizzle-orm/blob/0.45.4"
const kysely = "https://github.com/kysely-org/kysely/blob/v0.29.8"
const prisma = "https://www.prisma.io/docs/orm/v7"
const orchid =
  "https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd"

export const ormMatrix = defineMatrix({
  projects: [
    { id: "kern", name: "kern-orm", version },
    { id: "drizzle", name: "Drizzle ORM", version: "0.45.4", url: "https://orm.drizzle.team/" },
    { id: "kysely", name: "Kysely", version: "0.29.8", url: "https://kysely.dev/" },
    { id: "prisma", name: "Prisma ORM", version: "7.10.1", url: "https://www.prisma.io/orm" },
    {
      id: "orchid",
      name: "Orchid ORM",
      version: "1.78.47",
      url: "https://orchid-orm.netlify.app/",
    },
  ],
  groups: [
    {
      id: "queries",
      title: "Queries and relations",
      features: [
        {
          id: "related-records",
          title: "Related records in one statement",
          description:
            "Select the related records of each row, at any depth, typed and loaded by one SQL statement.",
          research: research("nested-rows.md#related-records-in-one-statement"),
          cells: {
            kern: { status: "supported", href: "/orm/queries/relations" },
            drizzle: {
              status: "supported",
              note: "Relational queries of `db.query` load relations as `LEFT JOIN LATERAL` subqueries.",
              href: `${drizzle}/drizzle-orm/src/pg-core/dialect.ts#L1313-L1372`,
            },
            kysely: {
              status: "limited",
              note: "It has no relations: nest a correlated subquery of each relation in `jsonArrayFrom` or `jsonObjectFrom` by hand.",
              href: `${kysely}/site/docs/recipes/0001-relations.md`,
            },
            prisma: {
              status: "preview",
              note: "`include` loads relations in one statement only with the preview feature `relationJoins`, and in a query per table otherwise.",
              href: `${prisma}/prisma-client/queries/relation-queries#relation-load-strategies-preview`,
            },
            orchid: {
              status: "supported",
              note: "Relations selected in `select` load as `LEFT JOIN LATERAL` subqueries.",
              href: `${orchid}/docs/src/guide/join.md#L37`,
            },
          },
        },
        {
          id: "first-row-of-each-group",
          title: "First row of each group",
          description: "Keep the first row of each group of keys with `DISTINCT ON`.",
          research: research("queries.md#the-first-row-of-each-group"),
          cells: {
            kern: { status: "supported", href: "/orm/queries/selecting#first-row-of-each-group" },
            drizzle: {
              status: "supported",
              note: "`selectDistinctOn`.",
              href: `${drizzle}/drizzle-orm/src/pg-core/db.ts#L281`,
            },
            kysely: {
              status: "supported",
              note: "`distinctOn`.",
              href: `${kysely}/src/query-builder/select-query-builder.ts#L413`,
            },
            orchid: {
              status: "supported",
              note: "`distinct` takes the columns of `DISTINCT ON`.",
              href: `${orchid}/docs/src/guide/query-methods.md#distinct`,
            },
          },
        },
        {
          id: "no-records",
          title: "Queries known to find nothing",
          description:
            "Mark a query as empty, such as for a user without permissions, so that reading its records runs no statement.",
          research: research("queries.md#a-query-known-to-find-no-records"),
          cells: {
            kern: { status: "supported", href: "/orm/queries/filtering#no-records" },
            orchid: {
              status: "supported",
              note: "`none`.",
              href: `${orchid}/docs/src/guide/query-methods.md#none`,
            },
          },
        },
        {
          id: "row-locks-with-relations",
          title: "Row locks with related records",
          description:
            "Lock the rows of a query that also selects their related records, and read the related records of the locked rows.",
          research: research("queries.md#row-locks-of-a-query-that-selects-related-records"),
          cells: {
            kern: { status: "supported", href: "/orm/locks#locking-rows" },
            orchid: {
              status: "limited",
              note: "`forUpdate()` of such a query fails unless it names its table, and after waiting for a lock the query returns the related record of the old row.",
              href: "https://github.com/romeerez/orchid-orm/blob/c4d62ea0e82f6d06c3b715fcf790113b2921a7ba/docs/src/guide/transactions.md#forupdate",
              version: "1.78.37",
            },
          },
        },
        {
          id: "row-locks-without-waiting",
          title: "Row locks without waiting",
          description:
            "Fail at once instead of waiting for a row that another transaction locked, with `NOWAIT`.",
          research: research("queries.md#row-locks-without-waiting"),
          cells: {
            kern: { status: "supported", href: "/orm/locks#locking-rows" },
            orchid: {
              status: "unsupported",
              note: "Its `noWait()` compiles to `NO WAIT`, which PostgreSQL 18 rejects as a syntax error.",
              href: `${orchid}/packages/pqb/src/query/basic-features/for/for.ts#L13`,
            },
          },
        },
        {
          id: "statement-comments",
          title: "SQL statement comments",
          description:
            "Label the statement of a query with a comment, such as to find it in `pg_stat_activity`.",
          research: research("queries.md#comments-of-statements"),
          cells: {
            kern: { status: "supported", href: "/orm/queries/sql#comments" },
            drizzle: {
              status: "unsupported",
              note: "Its statements have no place for a comment.",
              href: `${drizzle}/drizzle-orm/src/pg-core/dialect.ts#L140`,
            },
            kysely: {
              status: "limited",
              note: "Its maintainers declined `comment()` in favor of `modifyFront` and `modifyEnd`, which add raw SQL after `SELECT` or at the end of the statement.",
              href: `${kysely}/src/query-compiler/default-query-compiler.ts#L175-L263`,
            },
            prisma: {
              status: "supported",
              note: "Plugins of `comments` add tags at the end of each statement.",
              href: "https://www.prisma.io/docs/orm/prisma-client/observability-and-logging/sql-comments",
            },
            orchid: {
              status: "unsupported",
              note: "Comments apply to tables and columns of migrations, not to queries.",
              href: "https://github.com/romeerez/orchid-orm/blob/pqb%400.73.36/docs/src/guide/define-tables.md#L22-L23",
            },
          },
        },
        {
          id: "results-converted-in-code",
          title: "Results converted in code",
          description:
            "Convert each record of a query, or its whole result, by a function, such as to a class or a formatted value.",
          research: research("results.md#map-of-a-null-value"),
          cells: {
            kern: { status: "supported", href: "/orm/queries/selecting#results-converted-in-code" },
            orchid: {
              status: "supported",
              note: "`map` converts each record, and `transform` the whole result.",
              href: `${orchid}/docs/src/guide/query-methods.md#map`,
            },
          },
        },
        {
          id: "joins",
          title: "Joins",
          description:
            "Join other tables to the rows of a query, and select and filter by their columns.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Select related records and their values through relations, or join tables in a SQL statement of `db.$query`.",
              href: "/orm/queries/relations",
              plan: backlog("joins.md"),
            },
          },
        },
        {
          id: "through-relations",
          title: "Relations through other relations",
          description:
            "Query the related records of related records, such as the answers of a form through its fields, as a relation.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Nest the relations in `select`, which gives the related records of each related record.",
              href: "/orm/queries/relations",
              plan: backlog("through-and-many-to-many-relations.md"),
            },
            orchid: {
              status: "supported",
              note: "`chain` queries the related records of related records.",
              href: `${orchid}/docs/src/guide/relation-queries.md#chain`,
            },
          },
        },
        {
          id: "many-to-many-relations",
          title: "Many-to-many relations",
          description: "Relate the records of two tables through a join table.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Relate the table to the join table with `many` and the join table to the other table with `one`, and nest both in `select`. Each related record comes inside its row of the join table.",
              href: "/orm/queries/relations",
              plan: backlog("through-and-many-to-many-relations.md"),
            },
          },
        },
        {
          id: "unions",
          title: "Unions of queries",
          description: "Combine the rows of several queries with `UNION ALL`.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Write the statement as SQL with `db.$query`, whose `select` decodes its rows.",
              href: "/orm/queries/sql#rows",
              plan: backlog("unions-and-common-table-expressions.md"),
            },
          },
        },
        {
          id: "common-table-expressions",
          title: "Common table expressions",
          description:
            "Name a query with `WITH`, and select from it or from another derived source.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Write the statement as SQL with `db.$query`, whose `select` decodes its rows.",
              href: "/orm/queries/sql#rows",
              plan: backlog("unions-and-common-table-expressions.md"),
            },
          },
        },
        {
          id: "recursive-queries",
          title: "Recursive queries",
          description:
            "Select the records of a relation of a table to itself at any depth, such as the ancestors of a category, with `WITH RECURSIVE`.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Write the statement as SQL with `db.$query`, whose `select` decodes its rows.",
              href: "/orm/queries/sql#rows",
              plan: backlog("records-of-a-relation-at-any-depth.md"),
            },
          },
        },
        {
          id: "keyset-pagination",
          title: "Keyset pagination",
          description: "Read the page after the sort keys of the last row of the previous page.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Filter by the sort keys of the last row with `where`.",
              href: "/orm/queries/filtering",
              plan: backlog("keyset-pagination.md"),
            },
          },
        },
        {
          id: "scopes",
          title: "Scopes and soft delete",
          description:
            "Apply the conditions of a table to its queries, such as to leave out soft-deleted records.",
          cells: {
            kern: { status: "unsupported", plan: backlog("scopes-and-soft-delete.md") },
            orchid: {
              status: "supported",
              note: "`scopes` and soft delete of a table.",
              href: `${orchid}/docs/src/guide/scopes.md`,
            },
          },
        },
      ],
    },
    {
      id: "expressions",
      title: "Expressions",
      features: [
        {
          id: "arithmetic",
          title: "Typed arithmetic",
          description:
            "Add, subtract, multiply, and divide expressions with a typed result, such as `price * quantity`.",
          research: research("expressions.md#arithmetic-of-expressions"),
          cells: {
            kern: { status: "supported", href: "/orm/queries/operators#arithmetic" },
            drizzle: {
              status: "limited",
              note: "Its operators compare values; write arithmetic in a `sql` fragment.",
              href: `${drizzle}/drizzle-orm/src/sql/expressions/conditions.ts`,
            },
            kysely: {
              status: "supported",
              note: "`eb(lhs, op, rhs)` takes an arithmetic operator and types the result by its left operand.",
              href: `${kysely}/src/expression/expression-builder.ts#L172-L190`,
            },
          },
        },
        {
          id: "aggregate-nullability",
          title: "Nullability of aggregates",
          description:
            "Type `sum`, `min`, and other aggregates as nullable only where they can return `NULL`, such as over no rows.",
          research: research("aggregates.md#aggregates-of-a-group"),
          cells: {
            kern: { status: "supported", href: "/orm/queries/aggregates" },
            kysely: {
              status: "limited",
              note: "`sum` and `avg` are typed without `null`, and its documentation recommends adding it by hand.",
              href: `${kysely}/src/query-builder/function-module.ts#L216`,
            },
            orchid: {
              status: "limited",
              note: "`min`, `max`, `sum`, and `avg` are nullable also in groups, which always have rows.",
              href: `${orchid}/docs/src/guide/aggregate.md#min`,
            },
          },
        },
        {
          id: "vector-distances",
          title: "pgvector distances",
          description:
            "Store embeddings in `vector` columns and sort by their distances with the operators of pgvector.",
          research: research("expressions.md#vectors-of-pgvector"),
          cells: {
            kern: { status: "supported", href: "/orm/queries/operators#vector-distances" },
            drizzle: {
              status: "supported",
              note: "`vector` of `pg-core`, and functions of distances such as `cosineDistance`.",
              href: `${drizzle}/drizzle-orm/src/sql/functions/vector.ts`,
            },
            kysely: {
              status: "external",
              note: "pgvector-node adds the type and the functions of distances.",
              href: "https://github.com/pgvector/pgvector-node/blob/v0.3.1/src/kysely/index.js",
            },
            prisma: {
              status: "unsupported",
              note: "A `vector` column is `Unsupported`, which the client leaves out, so its queries are SQL text.",
              href: "https://github.com/prisma/orm/issues/18442",
            },
            orchid: {
              status: "unsupported",
              note: "A `vector` column is a custom type of `unknown` values without operators.",
              version: "pqb 0.73.49",
              href: "https://github.com/romeerez/orchid-orm/blob/69c1e00283a9c08d1422d1dae6e6ef9caa52fd38/packages/pqb/src/columns/column-types/custom-type.ts",
            },
          },
        },
        {
          id: "json-operators",
          title: "JSON operators",
          description:
            "Filter and select by the properties of JSON values, such as `config->>'type'`, typed by their shape.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Write the expression in a fragment of `sql(type)`, which decodes its result by the type.",
              href: "/orm/queries/selecting",
              plan: backlog("json-operators.md"),
            },
            orchid: {
              status: "supported",
              note: "Operators of `jsonb` columns and functions of JSON paths.",
              href: `${orchid}/docs/src/guide/where.md#jsonb-column-operators`,
            },
          },
        },
        {
          id: "date-arithmetic",
          title: "Date and interval arithmetic",
          description:
            "Add an interval to a timestamp, or subtract timestamps, with a typed result.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Write the expression in a fragment of `sql(type)`, which decodes its result by the type.",
              href: "/orm/queries/selecting",
              plan: backlog("arithmetic-of-dates-and-intervals.md"),
            },
          },
        },
        {
          id: "text-concatenation",
          title: "Text concatenation",
          description: "Concatenate text, such as of a full name, without a SQL fragment.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Write the expression in a fragment of `sql(type)`, which decodes its result by the type.",
              href: "/orm/queries/selecting",
              plan: backlog("concatenation-of-text.md"),
            },
          },
        },
        {
          id: "window-functions",
          title: "Window functions",
          description:
            "Compute a value over a window of rows with `OVER`, such as a running total.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Write the expression in a fragment of `sql(type)`, which decodes its result by the type.",
              href: "/orm/queries/selecting",
              plan: backlog("other-options-of-aggregate-functions.md"),
            },
            orchid: {
              status: "supported",
              note: "`over` of aggregate functions.",
              href: `${orchid}/docs/src/guide/aggregate.md`,
            },
          },
        },
        {
          id: "distinct-aggregates",
          title: "Aggregates of distinct values",
          description:
            "Aggregate the distinct values of an expression beyond counting them, such as `sum(DISTINCT amount)`.",
          cells: {
            kern: {
              status: "unsupported",
              note: "`countDistinct` counts distinct values; write another aggregate in a fragment of `sql(type)`, which decodes its result by the type.",
              href: "/orm/queries/aggregates",
              plan: backlog("other-options-of-aggregate-functions.md"),
            },
            orchid: {
              status: "supported",
              note: "`distinct` of aggregate functions.",
              href: `${orchid}/docs/src/guide/aggregate.md`,
            },
          },
        },
        {
          id: "other-vector-types",
          title: "Other pgvector types",
          description:
            "Store `halfvec`, `sparsevec`, and `bit` vectors, and sort by their distances.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Define `halfvec` as a custom type with `withOperators(vectorOperators)`, which adds its distances.",
              href: "/orm/custom-types",
              plan: backlog("other-vector-types-of-pgvector.md"),
            },
            drizzle: {
              status: "supported",
              note: "`halfvec`, `sparsevec`, and `bit` of `pg-core`, with `hammingDistance` and `jaccardDistance`.",
              href: `${drizzle}/drizzle-orm/src/sql/functions/vector.ts`,
            },
          },
        },
      ],
    },
    {
      id: "mutations",
      title: "Mutations",
      features: [
        {
          id: "increments",
          title: "Atomic increments",
          description: "Set a column from its current value in an update, such as `viewCount + 1`.",
          research: research("mutations.md#increment-of-a-column"),
          cells: {
            kern: { status: "supported", href: "/orm/queries/mutations#updating" },
            kysely: {
              status: "supported",
              note: "`set` takes `eb('age', '+', 1)`.",
              href: `${kysely}/src/expression/expression-builder.ts#L125-L141`,
            },
            prisma: {
              status: "supported",
              note: "`increment`, `decrement`, `multiply`, and `divide`, one per field.",
              href: `${prisma}/reference/prisma-client-reference#atomic-number-operations`,
            },
            orchid: {
              status: "supported",
              note: "`increment` and `decrement`.",
              href: `${orchid}/docs/src/guide/update.md#increment`,
            },
          },
        },
        {
          id: "upserts",
          title: "Upserts in one statement",
          description:
            "Insert a record or update the existing one with `ON CONFLICT ... DO UPDATE`, so that concurrent upserts do not fail with a unique violation.",
          research: research("mutations.md#upserts-of-the-record-of-a-key"),
          cells: {
            kern: {
              status: "supported",
              href: "/orm/queries/mutations#records-that-already-exist",
            },
            orchid: {
              status: "supported",
              note: "`onConflict` with `merge`; its `upsert` of a record runs an `UPDATE`, and an `INSERT` only when the update finds no row, so of two concurrent upserts of a missing record one fails.",
              href: `${orchid}/docs/src/guide/create.md#onconflict`,
            },
          },
        },
        {
          id: "inserts-that-skip-conflicts",
          title: "Inserts that skip conflicting rows",
          description:
            "Insert records, and skip each one whose key already exists, with `ON CONFLICT ... DO NOTHING`.",
          research: research("mutations.md#inserts-that-skip-the-rows-that-conflict"),
          cells: {
            kern: {
              status: "supported",
              href: "/orm/queries/mutations#records-that-already-exist",
            },
            orchid: {
              status: "supported",
              note: "`onConflictDoNothing`.",
              href: `${orchid}/docs/src/guide/create.md#onconflictdonothing`,
            },
          },
        },
        {
          id: "defaults-in-code",
          title: "Defaults computed in code",
          description:
            "Compute the default of a column in code for each inserted record, such as an identifier.",
          research: research("mutations.md#defaults-of-columns-in-code"),
          cells: {
            kern: { status: "supported", href: "/orm/tables#defaults-in-code" },
            drizzle: {
              status: "supported",
              note: "`$defaultFn`.",
              href: `${drizzle}/drizzle-orm/src/pg-core/dialect.ts#L541-L546`,
            },
            orchid: {
              status: "supported",
              note: "A callback of `.default`; a value or a SQL fragment is a default of the database.",
              href: `${orchid}/docs/src/guide/common-column-methods.md#default`,
            },
          },
        },
        {
          id: "bulk-updates",
          title: "Bulk updates with per-row values",
          description:
            "Update several records, each with its own values, in one statement matched by a key.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Write the statement as SQL with `db.$query`.",
              href: "/orm/queries/sql",
              plan: backlog("updating-records-with-values-of-each.md"),
            },
            orchid: {
              status: "supported",
              note: "`updateMany` and `updateManyBy`.",
              href: `${orchid}/docs/src/guide/update.md#updatemany`,
            },
          },
        },
        {
          id: "insert-select",
          title: "Inserts from a query",
          description: "Insert the records that a query selects with `INSERT ... SELECT`.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Write the statement as SQL with `db.$query`.",
              href: "/orm/queries/sql",
              plan: backlog("inserting-the-records-of-a-query.md"),
            },
            orchid: {
              status: "supported",
              note: "`createOneFrom` and `createForEachFrom`.",
              href: `${orchid}/docs/src/guide/create.md#createonefrom-insertfrom`,
            },
          },
        },
        {
          id: "inserts-beyond-the-parameter-limit",
          title: "Inserts beyond the parameter limit in one call",
          description:
            "Insert more values than the 65535 parameters of one statement by one call, such as tens of thousands of records.",
          research: research("mutations.md#inserts-beyond-the-parameter-limit"),
          cells: {
            kern: {
              status: "unsupported",
              note: "Call `insertMany` with batches of the records in a transaction.",
              href: "/orm/queries/mutations#many-records",
              plan: backlog("bulk-inserts-beyond-the-parameter-limit.md"),
            },
            orchid: {
              status: "supported",
              note: "It splits such an insert into several statements.",
              href: "https://github.com/romeerez/orchid-orm/pull/811",
            },
          },
        },
        {
          id: "values-before-an-update",
          title: "Values before an update",
          description:
            "Return the values of a changed row before the update, with `old` of `RETURNING` of PostgreSQL 18.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Write the statement as SQL with `db.$query`, whose `select` decodes its rows.",
              href: "/orm/queries/sql#rows",
              plan: backlog("values-before-an-update.md"),
            },
          },
        },
        {
          id: "nested-writes",
          title: "Nested writes",
          description: "Insert or update a record together with its related records in one call.",
          cells: {
            kern: { status: "unsupported", plan: backlog("relation-aware-mutations.md") },
          },
        },
      ],
    },
    {
      id: "data-model",
      title: "Data model and types",
      features: [
        {
          id: "views",
          title: "Existing views",
          description: "Query an existing view with results typed by its declared columns.",
          research: research("schemas.md#reading-postgresql-views"),
          cells: {
            kern: { status: "supported", href: "/orm/views" },
            drizzle: {
              status: "supported",
              note: "`pgView(name, columns).existing()`.",
              href: "https://orm.drizzle.team/docs/views",
            },
            prisma: {
              status: "preview",
              note: "The preview feature `views` gives a read-only model of a `view` block.",
              href: `${prisma}/prisma-schema/data-model/views`,
            },
            orchid: {
              status: "supported",
              note: "`defineView` of its table factory.",
              href: "https://unpkg.com/orchid-orm@1.78.61/dist/index.d.ts",
              version: "1.78.61",
            },
          },
        },
        {
          id: "materialized-views",
          title: "Materialized views",
          description: "Query an existing materialized view with typed results.",
          research: research("schemas.md#reading-postgresql-views"),
          cells: {
            kern: { status: "supported", href: "/orm/views" },
            prisma: {
              status: "unsupported",
              note: "Its schema has no materialized views.",
              href: `${prisma}/prisma-schema/data-model/views`,
            },
            orchid: {
              status: "supported",
              note: "`defineView` of a materialized view, which is read-only.",
              href: "https://unpkg.com/orchid-orm@1.78.61/dist/index.d.ts",
              version: "1.78.61",
            },
          },
        },
        {
          id: "singleton-tables",
          title: "Singleton tables",
          description:
            "Declare a table of at most one row, such as of settings, read and changed without a key.",
          research: research("schemas.md#tables-of-one-row"),
          cells: {
            kern: { status: "supported", href: "/orm/singleton-tables" },
            orchid: {
              status: "unsupported",
              note: "Pass a constant key to every query, or read the row with `take` and change it with `all`.",
              href: "https://github.com/romeerez/orchid-orm/issues/752",
            },
          },
        },
        {
          id: "narrowing-values",
          title: "Narrowing column values",
          description:
            "Restrict the values of a column to a narrower type, such as a union of strings that a `CHECK` constraint allows or the shape of a JSON value, checked against the type of the column.",
          research: research("schemas.md#unions-of-column-values"),
          cells: {
            kern: {
              status: "limited",
              note: "`of<T>()` narrows the values that a column returns and accepts to the same type, so a type that accepts more values than it returns, such as `Date` of `timestamptz`, loses them.",
              href: "/orm/types#narrowing-values",
              plan: backlog("narrowing-returned-and-accepted-values-apart.md"),
            },
            drizzle: {
              status: "limited",
              note: "`$type<T>()` takes any type, also one outside the values of the column; `text({ enum })` infers a union from a list of strings.",
              href: `${drizzle}/drizzle-orm/src/column-builder.ts`,
            },
            orchid: {
              status: "supported",
              note: "`narrowType` narrows the values of a column, and `narrowAllTypes` narrows the values that it returns and accepts apart.",
              href: `${orchid}/docs/src/guide/common-column-methods.md#narrowalltypes`,
            },
          },
        },
        {
          id: "types-read-by-an-expression",
          title: "Types read by a SQL expression",
          description:
            "Define a custom type whose values a query selects through a SQL expression, such as `ST_AsGeoJSON(value)`.",
          research: research("schemas.md#types-read-by-a-sql-expression"),
          cells: {
            kern: {
              status: "supported",
              href: "/orm/custom-types#reading-values-by-an-expression",
            },
            drizzle: {
              status: "unsupported",
              note: "`customType` converts values in JavaScript, and a query selects the column as it is.",
              href: `${drizzle}/drizzle-orm/src/pg-core/columns/custom.ts#L185-L197`,
            },
          },
        },
        {
          id: "standalone-column-types",
          title: "Standalone column types",
          description:
            "Export a column type, such as `cryptoAmount`, from a module or an npm package, and use it in the table definitions of another project.",
          research: research("schemas.md#column-types-defined-apart-from-tables"),
          cells: {
            kern: { status: "supported", href: "/orm/custom-types" },
            orchid: {
              status: "declined",
              note: "Column types come from the table factory of a project, and its maintainers declined types defined apart from it.",
              href: "https://github.com/romeerez/orchid-orm/issues/405",
            },
          },
        },
        {
          id: "json-null",
          title: "JSON `null` distinct from SQL `NULL`",
          description: "Write, filter, and read a JSON `null` value apart from SQL `NULL`.",
          research: research("schemas.md#json-null-values-told-from-null"),
          cells: {
            kern: { status: "supported", href: "/orm/types#json-null-values" },
            drizzle: {
              status: "unsupported",
              note: "It writes `null` as `NULL`, and a result has `null` for both.",
              href: `${drizzle}/drizzle-orm/src/sql/sql.ts#L238`,
            },
            kysely: {
              status: "unsupported",
              note: "It passes `null` as `NULL`, and a result has what the driver parsed, `null` for both.",
              href: `${kysely}/src/dialect/postgres/postgres-driver.ts#L231-L234`,
            },
            prisma: {
              status: "limited",
              note: "`Prisma.JsonNull` and `Prisma.DbNull` tell them apart in writes and filters, and a result has `null` for both.",
              href: "https://github.com/prisma/prisma/blob/7.10.1/packages/client/tests/functional/json-null-types/tests.ts#L11-L27",
            },
            orchid: {
              status: "unsupported",
              note: "It writes `null` as `NULL`, and a result has `null` for both.",
              href: "https://github.com/romeerez/orchid-orm/blob/orchid-orm@1.78.47/docs/src/guide/columns-types.md#L486-L501",
            },
          },
        },
        {
          id: "naming-conventions",
          title: "Custom naming conventions",
          description:
            "Convert the keys of columns to their names by any function, such as for a legacy database.",
          research: research("schemas.md#column-naming-conventions"),
          cells: {
            kern: { status: "supported", href: "/orm/tables#naming-conventions" },
            orchid: {
              status: "declined",
              note: "It has only its own `snakeCase`, and its maintainers declined a function of names.",
              href: "https://github.com/romeerez/orchid-orm/issues/197",
            },
          },
        },
        {
          id: "schema-per-tenant",
          title: "A schema per tenant",
          description:
            "Serve the PostgreSQL schema of each request, such as of its tenant, from one instance, while shared tables stay in their schema.",
          research: research("schemas.md#postgresql-schemas-chosen-at-runtime"),
          cells: {
            kern: { status: "supported", href: "/orm/multiple-schemas" },
            drizzle: {
              status: "unsupported",
              note: "A table belongs to the schema of its definition.",
              href: `${drizzle}/drizzle-orm/src/pg-core/schema.ts#L9-L24`,
            },
            kysely: {
              status: "limited",
              note: "`withSchema` gives an instance per schema, and the shared tables are qualified in the types of the database.",
              href: `${kysely}/site/docs/recipes/0007-schemas.md`,
            },
            prisma: {
              status: "unsupported",
              note: "A schema per tenant requires a client per schema.",
              href: "https://github.com/prisma/prisma/blob/7.10.1/packages/adapter-pg/src/pg.ts#L171-L173",
            },
            orchid: {
              status: "supported",
              note: "The `schema` option of `orchidORM` takes a function, called for every query.",
              href: `${orchid}/docs/src/guide/orm-setup.md#global-db-schema`,
            },
          },
        },
        {
          id: "computed-columns",
          title: "Computed columns",
          description:
            "Define a column of a table as an expression over its other columns, which queries select, filter, and sort by.",
          cells: {
            kern: { status: "unsupported", plan: backlog("computed-columns.md") },
            orchid: {
              status: "supported",
              note: "`computed` and `computeAtRuntime`.",
              href: `${orchid}/docs/src/guide/computed-columns.md`,
            },
          },
        },
        {
          id: "generated-columns",
          title: "Generated columns",
          description:
            "Declare a column that the database computes, which inserts and updates reject.",
          cells: {
            kern: { status: "unsupported", plan: backlog("generated-columns.md") },
          },
        },
        {
          id: "branded-types",
          title: "Branding a column by a method",
          description:
            "Brand the values of a column, such as an identifier, by a method of the column, so that types reject a mixed-up value of another column.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Narrow the column with `of<T>()` to a branded type of your own.",
              href: "/orm/types#narrowing-values",
              plan: backlog("branded-types-of-columns.md"),
            },
            orchid: {
              status: "supported",
              note: "`brand()`.",
              href: `${orchid}/docs/src/guide/common-column-methods.md#brand`,
            },
          },
        },
      ],
    },
    {
      id: "transactions",
      title: "Transactions and errors",
      features: [
        {
          id: "ambient-transactions",
          title: "Transactions without passing them around",
          description:
            "Run the queries of called functions in the current transaction without a transaction object passed to them.",
          research: research("transactions.md#ambient-transactions"),
          cells: {
            kern: { status: "supported", href: "/orm/transactions" },
            drizzle: {
              status: "unsupported",
              note: "Only the queries of the `tx` passed to the callback of `transaction` run in it.",
              href: `${drizzle}/drizzle-orm/src/pg-core/db.ts#L636-L641`,
            },
            kysely: {
              status: "unsupported",
              note: "Only the queries of the transaction object run in it.",
              href: `${kysely}/src/kysely.ts#L241-L260`,
            },
            prisma: {
              status: "unsupported",
              note: "Only the queries of the `tx` passed to the callback of `$transaction` run in it.",
              href: `${prisma}/prisma-client/queries/transactions#interactive-transactions`,
            },
            orchid: {
              status: "supported",
              note: "`$transaction` keeps the transaction in `AsyncLocalStorage`.",
              href: `${orchid}/docs/src/guide/transactions.md#transaction`,
            },
          },
        },
        {
          id: "nested-transactions",
          title: "Nested transactions",
          description:
            "Start a transaction in a transaction, as a savepoint that rolls back alone.",
          research: research("testing.md#tests-in-transactions-that-roll-back"),
          cells: {
            kern: { status: "supported", href: "/orm/transactions#nested-transactions" },
            drizzle: {
              status: "supported",
              note: "`transaction` of a `tx` starts a savepoint.",
              href: `${drizzle}/drizzle-orm/src/node-postgres/session.ts#L283-L300`,
            },
            kysely: {
              status: "unsupported",
              note: "`transaction` of a transaction throws.",
              href: `${kysely}/src/kysely.ts#L675-L690`,
            },
            orchid: {
              status: "supported",
              note: "A transaction in a transaction is a savepoint.",
              href: `${orchid}/docs/src/guide/transactions.md#testtransaction`,
            },
          },
        },
        {
          id: "joining-a-transaction",
          title: "Joining the current transaction",
          description:
            "Run a function in the current transaction, or in a transaction of its own when there is none.",
          research: research("transactions.md#joining-a-transaction"),
          cells: {
            kern: {
              status: "supported",
              href: "/orm/transactions#joining-the-current-transaction",
            },
            orchid: {
              status: "supported",
              note: "`$ensureTransaction`.",
              href: `${orchid}/docs/src/guide/transactions.md#ensuretransaction`,
            },
          },
        },
        {
          id: "error-conditions",
          title: "PostgreSQL error conditions",
          description:
            "Identify a database error by its PostgreSQL condition name, such as `unique_violation`.",
          research: research("errors.md#telling-a-rejected-statement-by-its-condition"),
          cells: {
            kern: { status: "supported", href: "/orm/errors" },
            orchid: {
              status: "limited",
              note: "`isUnique` of `QueryError` tells a unique violation, and other conditions require comparing `code`.",
              href: `${orchid}/packages/pqb/src/query/errors.ts#L105-L107`,
            },
          },
        },
        {
          id: "unique-constraint-columns",
          title: "Columns of a violated unique constraint",
          description:
            "Tell which columns a rejected insert or update duplicated, such as to show users which field is taken, without naming the constraint.",
          cells: {
            kern: {
              status: "unsupported",
              plan: backlog("columns-of-a-violated-unique-constraint.md"),
            },
            orchid: {
              status: "supported",
              note: "`columns` of its `QueryError` gives the keys of the columns.",
              href: `${orchid}/docs/src/guide/error-handling.md#database-error`,
            },
          },
        },
        {
          id: "after-commit-hooks",
          title: "After-commit hooks",
          description:
            "Run a callback after the current transaction commits, such as to send notifications of its changes.",
          cells: {
            kern: { status: "unsupported", plan: backlog("after-commit-hooks.md") },
            orchid: {
              status: "supported",
              note: "`$afterCommit`.",
              href: `${orchid}/docs/src/guide/transactions.md#aftercommit`,
            },
          },
        },
      ],
    },
    {
      id: "sql",
      title: "SQL statements",
      features: [
        {
          id: "rows-of-sql",
          title: "Decoded rows of SQL statements",
          description:
            "Decode the rows of a SQL statement by declared types, and reject a result without a declared column.",
          research: research("sql-queries.md#rows-of-sql-text"),
          cells: {
            kern: { status: "supported", href: "/orm/queries/sql#rows" },
            drizzle: {
              status: "unsupported",
              note: "`execute` types the rows by a type argument that nothing checks.",
              href: `${drizzle}/drizzle-orm/src/pg-core/db.ts#L615-L634`,
            },
            kysely: {
              status: "unsupported",
              note: "`sql` types the rows by a type argument that nothing checks.",
              href: `${kysely}/src/raw-builder/sql.ts#L79`,
            },
            prisma: {
              status: "unknown",
              note: "`$queryRaw` types the rows by a type argument that nothing checks, and the preview feature TypedSQL generates the types of the rows of a SQL file from the database.",
              href: `${prisma}/prisma-client/using-raw-sql/typedsql`,
            },
            orchid: {
              status: "unsupported",
              note: "`$query` types the rows by a type argument that nothing checks.",
              href: `${orchid}/docs/src/guide/orm-methods.md#query`,
            },
          },
        },
        {
          id: "names-known-at-runtime",
          title: "Names known at runtime",
          description:
            "Write the name of a table or a column that code chooses at runtime into a SQL statement, quoted as an identifier.",
          research: research("expressions.md#identifiers-in-sql-fragments"),
          cells: {
            kern: { status: "supported", href: "/orm/queries/sql#names-known-at-runtime" },
            drizzle: {
              status: "supported",
              note: "`sql.identifier`.",
              href: `${drizzle}/drizzle-orm/src/sql/sql.ts`,
            },
            kysely: {
              status: "supported",
              note: "`sql.id`.",
              href: `${kysely}/src/raw-builder/sql.ts#L271`,
            },
          },
        },
      ],
    },
    {
      id: "testing",
      title: "Testing",
      features: [
        {
          id: "test-transactions",
          title: "Tests in transactions that roll back",
          description:
            "Run each test in a transaction that rolls back, while the tested code queries the database of the application and starts transactions of its own.",
          research: research("testing.md#tests-in-transactions-that-roll-back"),
          cells: {
            kern: { status: "supported", href: "/orm/testing" },
            drizzle: {
              status: "unsupported",
              note: "It has no test helper, and the tested code joins the transaction of a test only through a `tx` passed to it.",
              href: `${drizzle}/drizzle-orm/src/node-postgres/session.ts#L283-L300`,
            },
            kysely: {
              status: "unsupported",
              note: "It has no test helper, and tested code that starts a transaction cannot run in the transaction of a test.",
              href: `${kysely}/src/kysely.ts#L675-L690`,
            },
            prisma: {
              status: "external",
              note: "jest-prisma runs each Jest test in a transaction that rolls back.",
              href: "https://github.com/Quramy/jest-prisma/blob/v1.8.2/README.md#transaction-rollback",
            },
            orchid: {
              status: "supported",
              note: "`testTransaction`.",
              href: `${orchid}/docs/src/guide/transactions.md#testtransaction`,
            },
          },
        },
        {
          id: "table-check",
          title: "Checking tables against the database",
          description:
            "Check in a test that the database has the columns, keys, and foreign keys that the table definitions rely on.",
          research: research("schemas.md#checking-tables-against-the-database"),
          cells: {
            kern: { status: "supported", href: "/orm/testing#tables-that-match-the-database" },
            drizzle: {
              status: "unsupported",
              note: "`drizzle-kit check` checks the files of migrations, not the database.",
              href: `${drizzle}/drizzle-kit/src/cli/commands/check.ts#L4-L17`,
            },
            kysely: {
              status: "external",
              note: "kysely-codegen generates types from the database, and its `--verify` fails when they are out of date.",
              href: "https://github.com/RobinBlomberg/kysely-codegen/blob/0.20.0/README.md",
            },
            prisma: {
              status: "limited",
              note: "`prisma migrate diff --exit-code` fails on any difference from the models in what Prisma ORM supports, also on an extra column.",
              href: "https://www.prisma.io/docs/cli/v7/migrate/diff",
            },
          },
        },
      ],
    },
    {
      id: "schema-management",
      title: "Schema management",
      link: { text: "Comparison of migrators", href: "/migrations/comparison" },
      features: [
        {
          id: "generated-migrations",
          title: "Migrations generated from tables",
          description: "Generate a migration from the changes of the table definitions.",
          research: research("migrations.md#generating-migrations-and-tables"),
          cells: {
            kern: {
              status: "unsupported",
              note: "Write migrations with schema helpers, SQL, or TypeScript.",
              href: "/migrations/writing",
            },
            drizzle: {
              status: "supported",
              note: "`drizzle-kit generate`.",
              href: `${drizzle}/drizzle-kit/src/cli/commands/migrate.ts#L302-L316`,
            },
            kysely: {
              status: "unsupported",
              note: "Its `Migrator` applies migrations written by hand.",
              href: `${kysely}/site/docs/migrations.mdx`,
            },
            prisma: {
              status: "supported",
              note: "`prisma migrate dev`.",
              href: "https://www.prisma.io/docs/cli/v7/migrate/dev",
            },
            orchid: {
              status: "supported",
              note: "`db g`.",
              href: `${orchid}/docs/src/guide/generate-migrations.md`,
            },
          },
        },
        {
          id: "pulled-tables",
          title: "Definitions generated from the database",
          description: "Generate typed definitions of the tables of an existing database.",
          research: research("migrations.md#generating-migrations-and-tables"),
          cells: {
            kern: {
              status: "unsupported",
              note: "Write the table definitions, and check them against the database in a test.",
              href: "/orm/testing#tables-that-match-the-database",
            },
            drizzle: {
              status: "supported",
              note: "`drizzle-kit pull`.",
              href: `${drizzle}/drizzle-kit/src/cli/commands/introspect.ts`,
            },
            kysely: {
              status: "external",
              note: "kysely-codegen generates the TypeScript types of the database.",
              href: "https://github.com/RobinBlomberg/kysely-codegen/blob/0.20.0/README.md",
            },
            orchid: {
              status: "supported",
              note: "`db pull`.",
              href: `${orchid}/docs/src/guide/migration-commands.md#pull`,
            },
          },
        },
      ],
    },
    {
      id: "databases",
      title: "Databases",
      features: [
        {
          id: "other-databases",
          title: "Databases other than PostgreSQL",
          description: "Run the same code on MySQL, SQLite, or another database.",
          cells: {
            kern: { status: "unsupported", note: "kern-orm is built for PostgreSQL alone." },
          },
        },
      ],
    },
  ],
})
