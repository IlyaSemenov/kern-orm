# kern-orm

Fully typed relational query builder for PostgreSQL with ambient transactions and single-query relation loading.

kern-orm is in early development, and the API changes between minor versions.

See the [documentation](https://ilyasemenov.github.io/kern-orm/).

## Packages

- [`kern-orm`](packages/kern-orm): tables, schemas, queries, SQL compiler, and transactions.
- [`@kern-orm/postgres-js`](packages/postgres-js): [postgres.js](https://github.com/porsager/postgres) driver.

## Development

```sh
bun install
bun run test
bun run types
bun run build
bun run docs:dev
```

Set `DATABASE_URL` to an empty database to run tests against PostgreSQL, such as in `.env.test.local` copied from [`.env.test.local.example`](.env.test.local.example); without it, those tests are skipped.
The tests roll back their changes.
