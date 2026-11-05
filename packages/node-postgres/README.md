# @kern-orm/node-postgres

[node-postgres](https://node-postgres.com/) driver for [kern-orm](https://github.com/IlyaSemenov/kern-orm).

## Install

```sh
npm install kern-orm @kern-orm/node-postgres pg
npm install --save-dev @types/pg
```

## Usage

```ts
import { nodePostgresDriver } from "@kern-orm/node-postgres"
import { createDatabase } from "kern-orm"
import { Pool } from "pg"

const database = createDatabase({
  driver: nodePostgresDriver(new Pool({ connectionString: process.env.DATABASE_URL })),
})
```
