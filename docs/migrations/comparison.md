---
aside: false
---

<script setup>
import ComparisonMatrix from "../.vitepress/comparison/ComparisonMatrix.vue"
import { migrationsMatrix } from "../.vitepress/comparison/migrations"
</script>

# Comparison

Comparisons: [kern-orm](../orm/comparison) · kern-migrations

This page helps you choose between kern-migrations and other migrators of PostgreSQL schemas for TypeScript: Drizzle Kit with the migrator of Drizzle ORM, the `Migrator` of Kysely, Prisma Migrate, rake-db, and node-pg-migrate.

## When kern-migrations fits

kern-migrations applies explicit, reversible migrations to any PostgreSQL schema and checks in tests that they roll back.

Key capabilities:

- [Indexes built concurrently](./outside-transaction) outside a transaction, with a failed build retried by the next `migrate`.
- [Separate migration histories](./package-migrations) for the application and its packages.
- [Migrations applied in a transaction](./applying#tenants) of the application, such as the one that creates a tenant.
- The same migrations applied to [any schema](./applying#without-a-db), such as the schema of each tenant.
- [Squashing a history](./squashing) without manual changes to existing databases.
- [Automated checks](./testing) that a rollback restores the previous structure of the schema.

## When kern-migrations does not fit

Choose another migrator when you need:

- Migrations generated from your table definitions: with kern-migrations, you write each migration with helpers, SQL, or TypeScript.
- Databases other than PostgreSQL.
- A stable API: kern-migrations is in early development, and its API changes between minor versions.

## Features

Hover over, focus, or tap a feature to see what it means, and an icon to see what a migrator does.

<ComparisonMatrix :matrix="migrationsMatrix" />

## About this comparison

- The column of Drizzle ORM covers Drizzle Kit and the migrator of Drizzle ORM, the column of Kysely its `Migrator`, and the column of Prisma ORM Prisma Migrate.
- The matrix compares the versions under the names of the projects, as of November 2026, by their documentation and sources; a cell checked in another version names it.
- A status tells what a migrator can do for the feature, not how close it is to kern-migrations.
- A question mark marks a feature not reviewed yet for a migrator, which it may have.
- To report a wrong or outdated cell, [open an issue](https://github.com/IlyaSemenov/kern-orm/issues).

## Detailed comparisons

The [research](https://github.com/IlyaSemenov/kern-orm/blob/main/comparison/migrations.md) behind the matrix records each scenario with its sources, including differences of implementation, edge cases that the matrix leaves out, and migrators of other languages, such as Django, Rails, and Alembic.
