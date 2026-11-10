# Custom Migration Helpers

To build steps that the [helpers](./migrations#helpers) do not cover, such as creating enum types, write a function that returns a step.
Quote names with `quoteIdentifier` and string values with `quoteLiteral`:

```ts [src/migration-helpers.ts]
import type { MigrationStep } from "@kern-orm/migrations"
import { quoteIdentifier, quoteLiteral } from "@kern-orm/migrations"

export function createEnum(name: string, values: readonly string[]): MigrationStep {
  return {
    up: `CREATE TYPE ${quoteIdentifier(name)} AS ENUM (${values.map(quoteLiteral).join(", ")})`,
    down: `DROP TYPE ${quoteIdentifier(name)}`,
  }
}
```

Use it in migrations as a built-in helper:

```ts [src/migrations/0003_create_form_status.ts]
import { defineMigration } from "@kern-orm/migrations"

import { createEnum } from "../migration-helpers.ts"

export default defineMigration(createEnum("form_status", ["draft", "published"]))
```

Do not change the SQL that a helper builds once a migration uses it: a new database, such as one for a new tenant, runs the migration with the helper again and must get the same result.
To change what a helper does, add a new helper or option.

## Undo a step

To build a helper that undoes what another one does, pass its step to `invertStep`, which swaps `up` and `down`, also those of [`outsideTransaction`](./migrations#your-own-changes-outside-a-transaction):

```ts
import { invertStep } from "@kern-orm/migrations"

export function dropEnum(name: string, values: readonly string[]): MigrationStep {
  return invertStep(createEnum(name, values))
}
```

## Combine steps

To combine several steps into one, such as adding columns shared by many tables, pass them to `combineSteps`: its `up` runs theirs in order, and its `down` runs theirs in reverse order.

```ts
import { addColumn, combineSteps } from "@kern-orm/migrations"

export function addTimestamps(table: string): MigrationStep {
  return combineSteps(
    addColumn(table, "created_at", "timestamptz NOT NULL DEFAULT now()"),
    addColumn(table, "updated_at", "timestamptz NOT NULL DEFAULT now()"),
  )
}
```
