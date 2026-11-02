# @kern-orm/postgres-js-v3

[postgres.js](https://github.com/porsager/postgres) 3 driver for [kern-orm](https://github.com/IlyaSemenov/kern-orm).
With postgres.js 4, use [`@kern-orm/postgres-js`](https://www.npmjs.com/package/@kern-orm/postgres-js) instead.

## Install

```sh
npm install kern-orm @kern-orm/postgres-js-v3 postgres@3
```

## Usage

```ts
import { postgresJsDriver } from "@kern-orm/postgres-js-v3"
import { createDatabase } from "kern-orm"
import postgres from "postgres"

const database = createDatabase({
  driver: postgresJsDriver(postgres(process.env.DATABASE_URL!)),
})
```

See [Drivers](https://ilyasemenov.github.io/kern-orm/drivers#postgres-js-3) for the limitations of postgres.js 3.
