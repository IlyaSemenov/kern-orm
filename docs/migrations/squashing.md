# Squashing Migrations

When your migration history grows long, replace its first migrations with a baseline: one migration that builds the same schema as they do.
New databases then run the baseline instead of them, and later you can delete them.

Write the baseline as an ordinary migration in a module whose name is not a migration name, such as `baseline.ts`.
Pass it to `defineMigrations` with the names of the migrations that it replaces, in order:

```ts [src/migrations.ts]
import { defineMigrations } from "kern-migrations"

export const migrations = defineMigrations(
  import.meta.glob([
    "./migrations/*.ts",
    "!./migrations/baseline.ts",
    "!./migrations/*.migration-test.ts",
  ]),
  {
    baseline: {
      migration: () => import("./migrations/baseline.ts"),
      replaces: ["0001_create_form", "0002_add_form_slug"],
    },
  },
)
```

On a schema without applied migrations, `migrate` runs the baseline, records the replaced migrations as applied, and applies the migrations after them.
A schema that has already applied the replaced migrations does not run the baseline.
Since a schema that the baseline built has the replaced migrations recorded, instances of the previous version of the application keep migrating it during a rolling deploy.

## Write the baseline

Build in the baseline the same schema and data as the replaced migrations, including the rows that they insert: the migrations after the baseline also run on schemas that the replaced migrations built.

Its `down` must undo everything that it builds: rolling back every migration runs it instead of the `down` of the replaced migrations.

A baseline cannot have changes [outside a transaction](./outside-transaction).

`verifyMigrations` checks the baseline instead of the replaced migrations and does not run their [migration tests](./testing#check-how-a-migration-changes-data).

## Roll back

When `rollback` undoes every migration from the first name of `replaces` on, such as with `"all"`, it undoes the migrations after the baseline and then runs the `down` of the baseline.
When it undoes fewer, it undoes the replaced migrations one by one by their own `down`, as long as you keep their modules.

`migrate` counts the baseline as one migration of `count`; `rollback` and `redo` do the same once you delete every replaced migration.

## Delete the replaced migrations

Delete the replaced migrations once every schema of the history has applied them, in a release whose instances do not run alongside those of an earlier version of the application.
Until then, a schema may lack some of them, and `migrate` cannot apply them without their modules.
Delete them with their migration tests, all at once or starting from the first one.

Under the same conditions, you can delete names from the start of `replaces` once their modules are gone; keep the last name.

To squash again, rewrite the baseline so that it also builds what the next migrations build, and add their names to the end of `replaces`.
