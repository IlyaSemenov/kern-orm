# SQL Queries and Scripts

In code that has the database but no `Db`, such as a runner of migrations, run statements with `database.query` and scripts with `database.script`:

```ts
import * as t from "kern-orm/db/types"

await database.script(await readFile("migrations/001-forms.sql", "utf8"))
const total = await database.query`SELECT count(*) FROM form`.get(t.integer)
// total: number
```

`database.query` runs and returns rows as [`$query`](./queries/sql) of a `Db` does; pass the types of `kern-orm/db/types` to its `select`, `get`, and `pluck`.

In code that uses no schemas, such as a runner of jobs, import `createDatabase` from `kern-orm/db`, which exports the database without the query builder:

```ts
import { postgresJsDriver } from "@kern-orm/postgres-js"
import { createDatabase } from "kern-orm/db"
import postgres from "postgres"

export const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})
```

The templates of `database.query` and `database.script` interpolate the SQL fragments of `kern-orm/db`, not the tables, expressions, and `sql` fragments of `kern-orm`: interpolate those with `$query` or `$script` of a `Db`.
To name an object known only at runtime there, interpolate `identifier` from `kern-orm/db`, which takes the names as [`identifier`](./queries/sql#names-known-at-runtime) of `kern-orm` does:

```ts
import { identifier } from "kern-orm/db"

await database.script`ANALYZE ${identifier(schemaName, tableName)}`
```

To pass JSON or an array, interpolate `param` from `kern-orm/db` with its type:

```ts
import { param } from "kern-orm/db"
import * as t from "kern-orm/db/types"

await database.query`UPDATE form SET tags = ${param(t.array(t.text), tags)} WHERE id = ${formId}`
```
