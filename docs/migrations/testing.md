# Testing Migrations

To check that every migration applies and rolls back, call `verifyMigrations` with your `Db` and the migrations in a test:

```ts [src/migrations.test.ts]
import { verifyMigrations } from "kern-migrations/testing"

import { test } from "../test/helpers.ts"
import { db } from "./db.ts"
import { migrations } from "./migrations.ts"

test("migrations", { timeout: 60_000 }, () =>
  verifyMigrations(db, migrations, {
    tests: new URL("./migrations/", import.meta.url),
  }),
)
```

`verifyMigrations` applies the migrations one by one to an empty schema of its own.
It rolls back each migration, checks that the structure of the schema is the same as before the migration, such as that no index or `NOT NULL` of the migration is left, and applies the migration again.
It runs `up` and `down` of a step with [`outsideTransaction`](./outside-transaction), so test the changes outside a transaction on a database of your own.
`tests` is the directory of your [migration tests](#check-how-a-migration-changes-data).

It rolls back all its changes.
Call it in a [test transaction](../database/testing), as any query of a database created with `test: true`.
Give the test a longer timeout: verifying a long history takes seconds.

With Vitest, pass the migration tests that `import.meta.glob` finds:

```ts
test(
  "migrations",
  () =>
    verifyMigrations(db, migrations, {
      tests: import.meta.glob("./migrations/*.migration-test.ts"),
    }),
  60_000,
)
```

Since the migrations apply to another schema, create extensions in a schema of their own, as [Extensions](./helpers#extensions) describes, even when your application has one schema.

## Check how a migration changes data

To check how a migration changes existing rows, write a migration test beside it, in a file named after the migration, such as `0003_add_form_slug.migration-test.ts`:

```ts [src/migrations/0003_add_form_slug.migration-test.ts]
import { expect } from "bun:test"

import { defineMigrationTest } from "kern-migrations/testing"
import * as t from "kern-orm/db/types"

export default defineMigrationTest("fills slugs from names", {
  setup: async database => {
    await database.query`INSERT INTO form (name, published) VALUES ('Customer Survey', false)`
  },
  assertUp: async database => {
    expect(await database.query`SELECT slug FROM form`.pluck(t.text)).toEqual(["customer-survey"])
  },
})
```

`setup` adds rows to the schema before the migration, and `assertUp` checks them after the migration applies.
To check them after the migration rolls back, pass `assertDown`; then the migration applies again.
Each callback receives the database of the migration, so write table names without a schema, as in migrations.
Each test starts from the schema before its migration, without the rows of other tests.

Do not import the tables of your application into a migration test: they describe the latest schema rather than the schema of the migration.

To check that a migration refuses some rows, such as a migration that adds a unique index, pass `assertUpError` instead of `assertUp` and `assertDown`.
The test fails unless the migration fails to apply, and `assertUpError` receives its `MigrationError`, with the error of PostgreSQL in `cause`:

```ts
export default defineMigrationTest("refuses forms whose slugs collide", {
  setup: async database => {
    await database.query`INSERT INTO form (name, published) VALUES ('Survey', false), ('SURVEY', false)`
  },
  assertUpError: error => {
    expect(error.message).toContain("could not create unique index")
  },
})
```

To write several tests of a migration, export an array of them, or write them in several files, such as `0003_add_form_slug.edge-cases.migration-test.ts`.

When you list the migrations with `import.meta.glob`, exclude their tests, as [List the migrations](./writing#list-the-migrations) shows.
