# @kern-orm/postgres-js

[postgres.js](https://github.com/porsager/postgres) driver for [kern-orm](https://github.com/IlyaSemenov/kern-orm).

## Install

```sh
npm install kern-orm @kern-orm/postgres-js postgres
```

## Usage

```ts
import { postgresJsDriver } from "@kern-orm/postgres-js"
import { createDatabase } from "kern-orm"
import postgres from "postgres"

const database = createDatabase({ driver: postgresJsDriver(postgres(process.env.DATABASE_URL)) })
```
