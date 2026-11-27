---
aside: false
---

<script setup>
import ComparisonMatrix from "../.vitepress/comparison/ComparisonMatrix.vue"
import { ormMatrix } from "../.vitepress/comparison/orm"
</script>

# Comparison

Comparisons: kern-orm · [kern-migrations](../migrations/comparison)

This page helps you choose between kern-orm and other TypeScript ORMs and query builders for PostgreSQL: Drizzle ORM, Kysely, Prisma ORM, and Orchid ORM.

## When kern-orm does not fit

Choose another library when you need:

- Databases other than PostgreSQL.
- Migrations generated from your table definitions: with kern-migrations, you write each migration with helpers, SQL, or TypeScript.
- A stable API: kern-orm is in early development, and its API changes between minor versions.

## Features

Hover over, focus, or tap a feature to see what it means, and an icon to see what a library does.

<ComparisonMatrix :matrix="ormMatrix" />

## About this comparison

- The column of kern-orm includes the transactions, test transactions, and queries of SQL text of kern-db, which kern-orm installs, and the migrations of kern-migrations, which you install beside it; see [Kern Libraries](../ecosystem).
- The matrix compares the versions under the names of the libraries, as of November 2026, by their documentation and sources; a cell checked in another version names it.
- A status tells what a library can do for the feature, not how close it is to kern-orm.
- A question mark marks a feature not reviewed yet for a library, which it may have.
- To report a wrong or outdated cell, [open an issue](https://github.com/IlyaSemenov/kern-orm/issues).

## Detailed comparisons

The [research](https://github.com/IlyaSemenov/kern-orm/tree/main/comparison) behind the matrix records each scenario with its sources, including differences of implementation and edge cases that the matrix leaves out:

- [Queries](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/queries.md)
- [Filters and expressions](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/expressions.md)
- [Aggregates and groups](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/aggregates.md)
- [Converting results](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/results.md)
- [Nested rows](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/nested-rows.md)
- [SQL generation](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/sql.md)
- [Mutations](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/mutations.md)
- [Queries of SQL text](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/sql-queries.md)
- [Tables and schemas](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/schemas.md)
- [Transactions](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/transactions.md)
- [Errors](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/errors.md)
- [Testing](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/testing.md)
- [Migrations](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/migrations.md)
