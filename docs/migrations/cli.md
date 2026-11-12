# Command Line

To apply, roll back, and create migrations from your terminal, write a script that runs the command line on your `Db` with your migrations:

```ts [src/migrations-cli.ts]
import { runMigrationCli } from "kern-migrations/cli"

import { db } from "./db.ts"
import { migrations } from "./migrations.ts"

await runMigrationCli(db, migrations, {
  directory: new URL("./migrations/", import.meta.url),
})
await db.$database.close()
```

Add it to the scripts of `package.json`, such as `"db": "node src/migrations-cli.ts"`, and run its commands:

```sh
npm run db migrate
npm run db rollback
npm run db status
npm run db new add_form_slug
```

- `migrate` applies the pending migrations; `migrate 2` applies the first two of them.
- `rollback` rolls back the last applied migration; `rollback 2` rolls back the last two, and `rollback all` every migration.
- `redo` rolls back the last applied migration and applies it again; `redo 2` does it for the last two.
- `status` lists the applied and the pending migrations.
- `new <name>` creates the module of the next migration.

When a command fails, `runMigrationCli` prints the error and sets the exit code of the process to 1 instead of rejecting, so the script closes the database after it in any case.

With a [PostgreSQL schema per tenant](../orm/multiple-schemas), pass the schema of the tenant with `--schema`, since the command line has no current tenant:

```sh
npm run db -- migrate --schema tenant_acme
```

For the migrations of another `Db`, such as of the SaaS schema, write a script of its own.

## Create a migration

`new` creates the module of the next migration in `directory`, such as `src/migrations/0003_add_form_slug.ts`, with a step whose names are blank:

```ts [src/migrations/0003_add_form_slug.ts]
import { addColumn, defineMigration } from "kern-migrations"

export default defineMigration([addColumn(/* table */ "", /* column */ "", "text")])
```

For the first migration of the directory, the step is `createTable`.
Fill in the names, or replace the step with the steps of your migration; until then, the migration fails to apply.

To create migrations from a template of your own, such as one that imports your helpers, pass `template`, which takes the name of the module, such as `0003_add_form_slug`, and returns its text.

On Node.js and Bun, which lack `import.meta.glob`, pass `listModule`: `new` writes there the [list of the migration modules](./writing#list-the-migrations) of the directory.

```ts
await runMigrationCli(db, migrations, {
  directory: new URL("./migrations/", import.meta.url),
  listModule: new URL("./migrations/index.ts", import.meta.url),
})
```

Create the list once, before your first migration, with the line by which `new` recognizes a list that it writes:

```ts [src/migrations/index.ts]
// Written by the new command of kern-migrations
export default {}
```

To let `new` write a list that you have written by hand, add that line at its top.

The list imports each module by its file name, such as `./0001_create_form.ts`.
To import the modules without the extension, as a bundler resolves them, pass `listModule: { path, extensions: false }`.
