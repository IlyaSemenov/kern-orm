# Kern Libraries

Kern is a family of PostgreSQL libraries for TypeScript.
Use each of them on its own, or several in one application:

- [kern-orm](./orm/getting-started): query your tables with results typed from their definitions, load related records in one SQL statement, and reuse tables across tenant schemas.
- [kern-db](./database/getting-started): run SQL statements with typed rows, share transactions across function calls without passing them around, and run tests in transactions that roll back.
  kern-orm runs on it, so an application of kern-orm has it already.
- [kern-migrations](./migrations/getting-started): change the schema of your database with helpers, SQL, or TypeScript functions, roll the changes back, and test them.
  It applies migrations through the `db` of kern-orm, the `database` of kern-db, or a driver of kern-db.
- [kern-jobs](https://ilyasemenov.github.io/kern-jobs/): run background jobs stored in PostgreSQL, and enqueue them in the transaction that writes their data.
  It works with postgres.js, node-postgres, Orchid ORM, kern-orm, kern-db, and [other clients](https://ilyasemenov.github.io/kern-jobs/database-clients#other-clients).

## Using them together

- Define your tables with kern-orm, create and change them with kern-migrations, and check in a test that the definitions [match the migrated database](./orm/testing#tables-that-match-the-database).
- Pass the `db` of kern-orm or the `database` of kern-db to kern-jobs, and the jobs that you enqueue in a [transaction](./orm/transactions) start only once it commits; see [kern-orm and kern-db](https://ilyasemenov.github.io/kern-jobs/database-clients#kern-orm-and-kern-db) in the kern-jobs docs.
