# Custom Migration Helpers

To build steps that the [helpers](./helpers) do not cover, such as comments of tables, write a function that returns a step.
Quote names with `quoteIdentifier` and string values with `quoteLiteral`:

```ts [src/migration-helpers.ts]
import type { MigrationStep } from "kern-migrations"
import { quoteIdentifier, quoteLiteral } from "kern-migrations"

export function addTableComment(table: string, comment: string): MigrationStep {
  return {
    up: `COMMENT ON TABLE ${quoteIdentifier(table)} IS ${quoteLiteral(comment)}`,
    down: `COMMENT ON TABLE ${quoteIdentifier(table)} IS NULL`,
  }
}
```

Use it in migrations as a built-in helper:

```ts [src/migrations/0003_comment_form.ts]
import { defineMigration } from "kern-migrations"

import { addTableComment } from "../migration-helpers.ts"

export default defineMigration(addTableComment("form", "Forms that tenants publish"))
```

Do not change the SQL that a helper builds once a migration uses it: a new database, such as one for a new tenant, runs the migration with the helper again and must get the same result.
To change what a helper does, add a new helper or option.

## Undo a step

To build a helper that undoes what another one does, pass its step to `invertStep`, which swaps `up` and `down`, also those of [`outsideTransaction`](./outside-transaction#your-own-changes-outside-a-transaction):

```ts
import { invertStep } from "kern-migrations"

export function dropTableComment(table: string, comment: string): MigrationStep {
  return invertStep(addTableComment(table, comment))
}
```

## Combine steps

To combine several steps into one, such as adding columns shared by many tables, pass them to `combineSteps`: its `up` runs theirs in order, and its `down` runs theirs in reverse order.

```ts
import { addColumn, combineSteps } from "kern-migrations"

export function addTimestamps(table: string): MigrationStep {
  return combineSteps(
    addColumn(table, "created_at", "timestamptz NOT NULL DEFAULT now()"),
    addColumn(table, "updated_at", "timestamptz NOT NULL DEFAULT now()"),
  )
}
```
