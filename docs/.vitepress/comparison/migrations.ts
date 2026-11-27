// The matrix of docs/migrations/comparison.md: kern-migrations against other migrators of PostgreSQL schemas for TypeScript.
// Each status of another project rests on a record of comparison/, which the row links, or on the item of backlog/ of a feature that kern-migrations lacks, and the cell links its source.

import { version } from "../../../packages/migrations/package.json"

import { backlog, defineMatrix, research } from "./matrix"

const drizzle = "https://github.com/drizzle-team/drizzle-orm/blob/0.45.4"
const kysely = "https://github.com/kysely-org/kysely/blob/v0.29.8"
const prismaClient = "https://github.com/prisma/prisma/blob/7.10.1"
const prismaEngines = "https://github.com/prisma/prisma-engines/blob/7.10.1"
const prismaSquashing =
  "https://github.com/prisma/docs/blob/7503f8376a127831ad15a4a46905b23a15369167/apps/docs/content/docs/orm/v7/prisma-migrate/workflows/squashing-migrations.mdx#L72-L116"
const orchid =
  "https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd"
const nodePgMigrate = "https://github.com/salsita/node-pg-migrate/blob/v9.0.0"
const rakeDbTesting = "https://github.com/IlyaSemenov/rake-db-testing/blob/v0.3.0"

export const migrationsMatrix = defineMatrix({
  projects: [
    { id: "kern", name: "kern-migrations", version },
    {
      id: "drizzle",
      name: "Drizzle ORM",
      version: "0.45.4",
      url: "https://orm.drizzle.team/docs/kit-overview",
    },
    { id: "kysely", name: "Kysely", version: "0.29.8", url: "https://kysely.dev/docs/migrations" },
    { id: "prisma", name: "Prisma ORM", version: "7.10.1", url: "https://www.prisma.io/migrate" },
    {
      id: "rakeDb",
      name: "rake-db",
      version: "2.37.48",
      url: "https://orchid-orm.netlify.app/guide/migration-setup-and-overview",
    },
    {
      id: "nodePgMigrate",
      name: "node-pg-migrate",
      version: "9.0.0",
      url: "https://salsita.github.io/node-pg-migrate/",
    },
  ],
  groups: [
    {
      id: "writing",
      title: "Writing migrations",
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
              note: "`drizzle-kit generate` generates a migration from the difference of the tables and the snapshot of the last migration.",
              href: `${drizzle}/drizzle-kit/src/cli/commands/migrate.ts#L302-L316`,
            },
            kysely: {
              status: "unsupported",
              note: "Its `Migrator` applies migrations written by hand.",
              href: `${kysely}/site/docs/migrations.mdx`,
            },
            prisma: {
              status: "supported",
              note: "`prisma migrate dev` generates SQL migrations from the models.",
              href: "https://www.prisma.io/docs/cli/v7/migrate/dev",
            },
            rakeDb: {
              status: "supported",
              note: "`db g` generates migrations from the tables of Orchid ORM.",
              href: `${orchid}/docs/src/guide/generate-migrations.md`,
            },
          },
        },
        {
          id: "column-types",
          title: "Column type builders",
          description:
            "Declare the columns of a table in a migration with functions of their types, as in table definitions, rather than SQL text.",
          research: research("migrations.md#column-types-of-migrations"),
          cells: {
            kern: {
              status: "unsupported",
              note: "Helpers take each column as SQL text, such as `text NOT NULL`.",
              href: "/migrations/helpers",
            },
            rakeDb: {
              status: "supported",
              note: "`createTable` and `changeTable` take column types.",
              href: `${orchid}/docs/src/guide/migration-writing.md#createtable-droptable`,
            },
          },
        },
        {
          id: "replaced-function-rollback",
          title: "Rollback of a replaced function",
          description:
            "Replace the definition of a function with a helper whose rollback restores the previous definition.",
          research: research("migrations.md#replacing-a-function"),
          cells: {
            kern: {
              status: "supported",
              href: "/migrations/helpers#replace-the-definition-of-a-function",
            },
            nodePgMigrate: {
              status: "unsupported",
              note: "`createFunction` with `replace: true` builds `CREATE OR REPLACE FUNCTION`, and its rollback drops the function.",
              href: `${nodePgMigrate}/src/operations/functions/createFunction.ts#L82-L92`,
            },
          },
        },
        {
          id: "enum-changes",
          title: "Reversible helpers that change enum values",
          description:
            "Add and remove the values of an enum type with a helper that rolls back the change, although PostgreSQL cannot drop a value of an enum.",
          cells: {
            kern: {
              status: "unsupported",
              note: "`createEnum` and `dropEnum` create and drop a type; change its values with SQL steps.",
              href: "/migrations/helpers",
              plan: backlog("migration-helpers-of-enums.md"),
            },
          },
        },
        {
          id: "recurrent-sql",
          title: "SQL run after every migration",
          description:
            "Run SQL again after migrating, such as the definitions of functions and views kept in files of their own.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Change functions and views in migrations, with `replaceFunction` and `replaceView`.",
              href: "/migrations/helpers",
              plan: backlog("recurrent-sql-of-migrations.md"),
            },
            rakeDb: {
              status: "supported",
              note: "Recurrent migrations.",
              href: `${orchid}/docs/src/guide/migration-setup-and-overview.md#recurrent-migrations`,
            },
          },
        },
      ],
    },
    {
      id: "applying",
      title: "Applying migrations",
      features: [
        {
          id: "outside-transaction",
          title: "Migrations outside a transaction",
          description:
            "Apply a migration that PostgreSQL rejects in a transaction, such as one with `CREATE INDEX CONCURRENTLY`.",
          research: research("migrations.md#migrations-outside-a-transaction"),
          cells: {
            kern: { status: "supported", href: "/migrations/outside-transaction" },
            drizzle: {
              status: "unsupported",
              note: "`migrate` runs every pending migration in one transaction.",
              href: `${drizzle}/drizzle-orm/src/pg-core/dialect.ts#L95-L111`,
            },
            kysely: {
              status: "supported",
              note: "`disableTransactions` runs the migrations of a call outside a transaction.",
              href: `${kysely}/src/migration/migrator.ts#L552-L579`,
            },
            prisma: {
              status: "supported",
              note: "Each statement of a migration runs on its own, outside a transaction.",
              href: `${prismaEngines}/schema-engine/connectors/sql-schema-connector/src/flavour/postgres/connector/native/mod.rs#L150-L161`,
            },
            rakeDb: {
              status: "unsupported",
              note: "It runs every migration in a transaction, of the whole call or of each migration.",
              href: `${orchid}/packages/rake-db/src/commands/migrate-or-rollback.ts#L67`,
            },
            nodePgMigrate: {
              status: "supported",
              note: "A migration that calls `noTransaction()` runs outside a transaction.",
              href: `${nodePgMigrate}/src/migration.ts#L355-L363`,
            },
          },
        },
        {
          id: "mixed-transactions",
          title: "Migrations in and outside transactions in one run",
          description:
            "Apply the migrations that need it outside a transaction and the other migrations of the same run in transactions.",
          research: research("migrations.md#migrations-outside-a-transaction"),
          cells: {
            kern: { status: "supported", href: "/migrations/outside-transaction" },
            drizzle: {
              status: "unsupported",
              note: "`migrate` runs every pending migration in one transaction.",
              href: `${drizzle}/drizzle-orm/src/pg-core/dialect.ts#L95-L111`,
            },
            kysely: {
              status: "unsupported",
              note: "`disableTransactions` runs every migration of a call outside a transaction.",
              href: `${kysely}/src/migration/migrator.ts#L552-L579`,
            },
            prisma: {
              status: "unsupported",
              note: "Each statement of every migration runs on its own, outside a transaction.",
              href: `${prismaEngines}/schema-engine/connectors/sql-schema-connector/src/flavour/postgres/connector/native/mod.rs#L150-L161`,
            },
            rakeDb: {
              status: "unsupported",
              note: "It runs every migration in a transaction.",
              href: `${orchid}/packages/rake-db/src/commands/migrate-or-rollback.ts#L67`,
            },
            nodePgMigrate: {
              status: "supported",
              note: "`noTransaction()` commits the transaction of the migrations before its migration and starts one for those after it.",
              href: `${nodePgMigrate}/src/migration.ts#L355-L363`,
            },
          },
        },
        {
          id: "application-transaction",
          title: "Migrating in a transaction of the application",
          description:
            "Apply migrations in a transaction of the application, such as one that creates the schema of a tenant, so that they commit or roll back with it.",
          research: research("migrations.md#migrating-inside-a-transaction"),
          cells: {
            kern: { status: "supported", href: "/migrations/applying#tenants" },
            drizzle: {
              status: "unsupported",
              note: "`migrate` given a transaction sends `begin` and `commit` on its connection on node-postgres, and fails on postgres.js.",
              href: `${drizzle}/drizzle-orm/src/node-postgres/session.ts#L248-L268`,
            },
            kysely: {
              status: "supported",
              note: "A `Migrator` given a transaction runs the migrations in it, and rejects `disableTransactions` there.",
              href: `${kysely}/src/migration/migrator.ts#L555-L569`,
            },
            prisma: {
              status: "unsupported",
              note: "Prisma Migrate applies migrations over a connection of its own.",
              href: `${prismaClient}/packages/migrate/src/SchemaEngineCLI.ts#L389-L405`,
            },
            rakeDb: {
              status: "supported",
              note: "`migrate` inside `$transaction` runs its own transaction as a savepoint.",
              href: `${orchid}/docs/src/guide/migration-programmatic-use.md#L310`,
            },
            nodePgMigrate: {
              status: "unsupported",
              note: "Its runner sends `BEGIN` and `COMMIT` on the client of `dbClient`.",
              href: `${nodePgMigrate}/src/runner.ts#L492-L507`,
            },
          },
        },
        {
          id: "another-library-transaction",
          title: "Migrating in a transaction of another library",
          description:
            "Apply migrations in a transaction that another client or ORM of the application started, such as postgres.js or Orchid ORM, so that they commit or roll back with it.",
          research: research("migrations.md#migrating-in-a-transaction-of-another-library"),
          cells: {
            kern: { status: "supported", href: "/migrations/applying#without-a-db" },
            drizzle: {
              status: "unsupported",
              note: "Over a client of node-postgres in a transaction, `migrate` sends `begin` and `commit` on it.",
              href: `${drizzle}/drizzle-orm/src/node-postgres/session.ts#L248-L268`,
            },
            kysely: {
              status: "unsupported",
              note: "Its dialect of PostgreSQL takes a pool, and begins and commits transactions itself.",
              href: `${kysely}/src/dialect/postgres/postgres-driver.ts#L77-L117`,
            },
            prisma: {
              status: "unsupported",
              note: "Prisma Migrate connects by the URL of its configuration.",
              href: "https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference",
            },
            rakeDb: {
              status: "unsupported",
              note: "`migrate` takes an instance of Orchid ORM or an adapter of pqb, which creates a pool of its own.",
              href: `${orchid}/packages/rake-db/src/utils.ts#L3-L9`,
            },
            nodePgMigrate: {
              status: "unsupported",
              note: "`dbClient` takes a client of node-postgres, on which the runner sends `BEGIN` and `COMMIT`.",
              href: `${nodePgMigrate}/src/runner.ts#L154-L165`,
            },
          },
        },
        {
          id: "rolling-deploys",
          title: "Older versions migrating during a rolling deploy",
          description:
            "Let instances of the previous version of the application start and migrate after a newer version has applied migrations that they lack.",
          research: research("migrations.md#state-of-a-target"),
          cells: {
            kern: { status: "supported", href: "/migrations/applying" },
            drizzle: {
              status: "supported",
              note: "The migrator applies only the migrations of its journal created after the last applied one.",
              href: `${drizzle}/drizzle-orm/src/pg-core/dialect.ts#L88-L111`,
            },
            kysely: {
              status: "unsupported",
              note: "Its `Migrator` rejects an executed migration that its provider lacks.",
              href: `${kysely}/src/migration/migrator.ts#L653-L665`,
            },
            prisma: {
              status: "supported",
              note: "`migrate deploy` accepts applied migrations that have no directory.",
              href: `${prismaEngines}/schema-engine/commands/src/commands/apply_migrations.rs#L26-L45`,
            },
          },
        },
        {
          id: "schemas-at-once",
          title: "Different schemas migrated concurrently",
          description:
            "Migrate different schemas of a database at once, such as those of tenants, each under a lock of its own.",
          research: research("migrations.md#locks-of-targets"),
          cells: {
            kern: { status: "supported", href: "/migrations/applying#tenants" },
            kysely: {
              status: "unsupported",
              note: "It locks every migration of a database with one key.",
              href: `${kysely}/src/dialect/postgres/postgres-adapter.ts#L6`,
            },
            nodePgMigrate: {
              status: "limited",
              note: "It locks every migration of a database with one key, unless `lockValue` gives another one.",
              href: `${nodePgMigrate}/src/runner.ts#L223-L227`,
            },
          },
        },
        {
          id: "lock-waiting",
          title: "Waiting for a migration that builds an index concurrently",
          description:
            "Wait for another process that migrates the same schema without a deadlock with its `CREATE INDEX CONCURRENTLY`, which waits for the snapshots of other sessions.",
          research: research("migrations.md#waiting-for-the-lock-of-a-target"),
          cells: {
            kern: { status: "supported", href: "/migrations/applying" },
            kysely: {
              status: "unsupported",
              note: "It waits in `pg_advisory_lock`, whose snapshot a concurrent index build of the process that holds the lock waits for, until a `lock_timeout` of an hour.",
              href: `${kysely}/src/dialect/postgres/postgres-adapter.ts#L18-L32`,
            },
            nodePgMigrate: {
              status: "unsupported",
              note: "It rejects when another process holds the lock, or, with `advisoryLockMode: 'wait'`, waits in `pg_advisory_lock`, whose snapshot a concurrent index build waits for.",
              href: `${nodePgMigrate}/src/runner.ts#L223-L242`,
            },
          },
        },
        {
          id: "failed-concurrent-index",
          title: "Retrying a failed concurrent index build",
          description:
            "Build an index concurrently again after a failed build, which leaves an index of its name that is not valid.",
          research: research("migrations.md#indexes-that-a-failed-concurrent-build-left"),
          cells: {
            kern: { status: "supported", href: "/migrations/outside-transaction" },
            drizzle: {
              status: "unsupported",
              note: "Drizzle Kit builds an index with `concurrently` without checking for one of its name, and `migrate` runs it in a transaction, where PostgreSQL rejects it.",
              href: `${drizzle}/drizzle-kit/src/sqlgenerator.ts#L3543-L3549`,
            },
            kysely: {
              status: "unsupported",
              note: "`createIndex()` has no concurrent build, and its `ifNotExists()` keeps an index that is not valid.",
              href: `${kysely}/src/schema/create-index-builder.ts#L43-L47`,
            },
            rakeDb: {
              status: "unsupported",
              note: "It runs every migration in a transaction, where PostgreSQL rejects a concurrent build.",
              href: `${orchid}/packages/rake-db/src/commands/migrate-or-rollback.ts#L67`,
            },
            nodePgMigrate: {
              status: "unsupported",
              note: "`createIndex` with `concurrently` and `ifNotExists` builds with `IF NOT EXISTS`, which keeps an index that is not valid.",
              href: `${nodePgMigrate}/src/operations/indexes/createIndex.ts#L74-L85`,
            },
          },
        },
        {
          id: "every-tenant",
          title: "A built-in command that migrates every tenant",
          description:
            "Migrate the schema of each tenant, from a list that the application gives, by one command.",
          cells: {
            kern: {
              status: "unsupported",
              note: "Call `migrate` with the `Db` of each tenant, in a loop of your own over the tenants or at the first request of each tenant in each process.",
              href: "/migrations/applying#tenants",
              plan: backlog("migrating-every-tenant.md"),
            },
          },
        },
      ],
    },
    {
      id: "histories",
      title: "Migration history",
      features: [
        {
          id: "squashing",
          title: "Squashing a history",
          description:
            "Replace the first migrations with a baseline that new databases run, while existing databases keep their state without a step on each of them.",
          research: research("migrations.md#replacing-a-history"),
          cells: {
            kern: { status: "supported", href: "/migrations/squashing" },
            kysely: {
              status: "unsupported",
              note: "Its `Migrator` rejects an executed migration that its provider lacks.",
              href: `${kysely}/src/migration/migrator.ts#L653-L665`,
            },
            prisma: {
              status: "limited",
              note: "Replace the migrations with one that `migrate diff` writes, and mark it as applied on each existing database with `migrate resolve --applied`.",
              href: prismaSquashing,
            },
            rakeDb: {
              status: "unsupported",
              note: "Squashing is an open feature request.",
              href: "https://github.com/romeerez/orchid-orm/issues/659",
            },
            nodePgMigrate: {
              status: "unsupported",
              note: "`fake` records migrations without running them, but its check of the order rejects applied migrations whose names differ from those of the files at their positions.",
              href: `${nodePgMigrate}/src/runner.ts#L368-L381`,
            },
          },
        },
        {
          id: "baseline-command",
          title: "Baselines written by a command",
          description: "Create the migration of a baseline with a command rather than by hand.",
          research: research("migrations.md#replacing-a-history"),
          cells: {
            kern: {
              status: "unsupported",
              note: "Write the baseline as an ordinary migration.",
              href: "/migrations/squashing#write-the-baseline",
              plan: backlog("writing-and-checking-a-baseline.md#writing"),
            },
            prisma: {
              status: "supported",
              note: "`migrate diff` writes the migration.",
              href: prismaSquashing,
            },
            rakeDb: {
              status: "supported",
              note: "`pull` writes a migration of an existing database.",
              href: `${orchid}/packages/rake-db/src/generate/pull.ts#L27-L34`,
            },
          },
        },
        {
          id: "baseline-check",
          title: "Baselines checked against their migrations",
          description:
            "Check that a baseline builds the same schema as the migrations that it replaces.",
          cells: {
            kern: {
              status: "unsupported",
              note: "`verifyMigrations` checks the baseline by itself.",
              href: "/migrations/squashing#write-the-baseline",
              plan: backlog("writing-and-checking-a-baseline.md#checking"),
            },
          },
        },
        {
          id: "adopting-a-database",
          title: "Migrations marked as applied on an existing schema",
          description:
            "Record migrations as applied without running them on a schema that already has their changes, such as one that another tool has built.",
          research: research("migrations.md#replacing-a-history"),
          cells: {
            kern: { status: "unsupported", plan: backlog("moving-from-rake-db.md") },
            prisma: {
              status: "supported",
              note: "`migrate resolve --applied` marks a migration as applied.",
              href: prismaSquashing,
            },
            rakeDb: {
              status: "supported",
              note: "`pull` writes a migration of an existing database and records it as applied.",
              href: `${orchid}/packages/rake-db/src/generate/pull.ts#L27-L34`,
            },
            nodePgMigrate: {
              status: "supported",
              note: "`fake` records migrations without running them.",
              href: `${nodePgMigrate}/src/runner.ts#L116-L119`,
            },
          },
        },
        {
          id: "renumbering-migrations",
          title: "Renumbering migrations",
          description:
            "Renumber the pending migrations of a merged branch after those already applied, by a command.",
          research: research("migrations.md#commands-around-migrating"),
          cells: {
            kern: {
              status: "unsupported",
              note: "Before a migration is applied anywhere, give it a number after the migrations already applied on any schema: `migrate` rejects a pending migration before an applied one.",
              href: "/migrations/applying",
            },
            rakeDb: {
              status: "supported",
              note: "`rebase` and `change-ids`.",
              href: `${orchid}/docs/src/guide/migration-commands.md#rebase`,
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
          id: "verifying-rollbacks",
          title: "Rollbacks checked against the structure",
          description:
            "Apply each migration, roll it back, check that the structure of the schema is the same as before it, and apply it again.",
          research: research("migrations.md#verifying-a-history"),
          cells: {
            kern: { status: "supported", href: "/migrations/testing" },
            rakeDb: {
              status: "limited",
              note: "The separate library rake-db-testing applies and rolls back each migration, but checks only the applied versions.",
              href: `${rakeDbTesting}/src/verify-migrations.ts#L53`,
            },
          },
        },
        {
          id: "data-tests",
          title: "Tests of data changes",
          description: "Test how a migration changes the rows that the schema has before it.",
          research: research("migrations.md#tables-in-migration-tests"),
          cells: {
            kern: {
              status: "supported",
              href: "/migrations/testing#check-how-a-migration-changes-data",
            },
            rakeDb: {
              status: "external",
              note: "Scenarios of rake-db-testing.",
              href: `${rakeDbTesting}/src/migration-scenario.ts#L17`,
            },
          },
        },
        {
          id: "irreversible-migrations",
          title: "Verifying irreversible migrations",
          description:
            "Verify a history with migrations whose rollback cannot restore the structure, such as one that adds a value to an enum type.",
          cells: {
            kern: {
              status: "unsupported",
              note: "`verifyMigrations` fails on such a migration.",
              href: "/migrations/testing",
              plan: backlog("irreversible-migrations-in-verification.md"),
            },
          },
        },
        {
          id: "verifying-changes-outside-a-transaction",
          title: "Verification that runs the changes outside a transaction",
          description:
            "Verify the changes that a migration makes outside a transaction as they run in production.",
          cells: {
            kern: {
              status: "unsupported",
              note: "`verifyMigrations` runs `up` and `down` of such a step instead; test the changes on a database of your own.",
              href: "/migrations/testing",
              plan: backlog("changes-outside-a-transaction-in-verification.md"),
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
          id: "creating-databases",
          title: "Commands that create and drop databases",
          description: "Create, drop, or reset a database from the command line of the migrator.",
          research: research("migrations.md#commands-around-migrating"),
          cells: {
            kern: {
              status: "unsupported",
              note: "Create and drop databases with the tools of PostgreSQL, such as `createdb`, or code of your own.",
            },
            rakeDb: {
              status: "supported",
              note: "Its commands create, drop, and reset a database.",
              href: `${orchid}/docs/src/guide/migration-commands.md#create-and-drop-a-database`,
            },
          },
        },
        {
          id: "other-databases",
          title: "Databases other than PostgreSQL",
          description: "Apply migrations to MySQL, SQLite, or another database.",
          cells: {
            kern: { status: "unsupported", note: "kern-migrations is built for PostgreSQL alone." },
          },
        },
      ],
    },
  ],
})
