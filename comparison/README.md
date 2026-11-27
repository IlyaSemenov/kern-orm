# Comparison with other projects

How other ORMs, query builders, and migrators handle the scenarios of kern-orm, by topic, as checked in their documentation, issues, sources, or a named version.
Each scenario states what kern-orm does, and gives each project a verdict:

- `fails`: it gets wrong what kern-orm covers.
- `lacks`: it lacks what kern-orm has.
- `has`: it has what kern-orm lacks.
- `differs`: it does the task another way.
- `same`: it does what kern-orm does.

## Projects

Records of other projects, here and in [decisions](../decisions/README.md), describe these versions unless a record names another one, and a record of an issue or a pull request tells what the project did then.

- [Orchid ORM](https://github.com/romeerez/orchid-orm) 1.78.47, with its query builder pqb 0.73.36 and its migrator rake-db 2.37.48.
- [Drizzle ORM](https://github.com/drizzle-team/drizzle-orm) 0.45.4.
- [Kysely](https://github.com/kysely-org/kysely) 0.29.8.
- [Prisma ORM](https://github.com/prisma/prisma) 7.10.1.
- [rake-db-testing](https://github.com/IlyaSemenov/rake-db-testing) 0.3.0.
- [jest-prisma](https://github.com/Quramy/jest-prisma) 1.8.2, tests of Prisma ORM in transactions.
- [kysely-codegen](https://github.com/RobinBlomberg/kysely-codegen) 0.20.0, TypeScript types for Kysely generated from the database.
- [Slonik](https://github.com/gajus/slonik) 49.13.0.
- [Bun SQL](https://bun.com/docs/runtime/sql) 1.4.4.
- [Postgres.js](https://github.com/porsager/postgres) 4.1.0.
- [node-postgres](https://github.com/brianc/node-postgres) 8.23.1.
- [Django](https://github.com/django/django) 6.0.10.
- [node-pg-migrate](https://github.com/salsita/node-pg-migrate) 9.0.0.
- [Rails](https://github.com/rails/rails) 8.1.4.1, with its migrations of Active Record.
- [Hibernate ORM](https://github.com/hibernate/hibernate-orm) 7.4.
- [Doctrine ORM](https://github.com/doctrine/orm) 3.5.0.
- [Alembic](https://github.com/sqlalchemy/alembic) 1.20.1.
- [pgvector-node](https://github.com/pgvector/pgvector-node) 0.3.1, the types and distances of pgvector for clients and query builders of Node.js.
- [TypeORM](https://github.com/typeorm/typeorm) 1.1.3.
- [knex](https://github.com/knex/knex) 3.3.0.
- [MikroORM](https://github.com/mikro-orm/mikro-orm) 7.2.11.
- [SQLAlchemy](https://github.com/sqlalchemy/sqlalchemy) 2.1.9.

## Topics

- [Queries](queries.md)
- [Filters and expressions](expressions.md)
- [Aggregates and groups](aggregates.md)
- [Converting results](results.md)
- [Nested rows](nested-rows.md)
- [SQL generation](sql.md)
- [Mutations](mutations.md)
- [Queries of SQL text](sql-queries.md)
- [Tables and schemas](schemas.md)
- [Transactions](transactions.md)
- [Errors](errors.md)
- [Testing](testing.md)
- [Migrations](migrations.md)

## Scenarios to compare

Scenarios worth comparing that the topics do not cover yet:

- Errors of drivers classified as a statement that PostgreSQL rejected or a lost connection, across clients.
- A connection returned to the pool in a transaction, such as after a failed `COMMIT` or a `BEGIN` sent outside a transaction.
- A transaction whose connection fails: whether it may have been committed, and whether it commits after its callback caught the error.
- The isolation level of a nested transaction, which PostgreSQL sets only for a whole transaction.
- Statements that PostgreSQL rejects in a transaction block, such as `CREATE INDEX CONCURRENTLY`, on one connection with its search path.

## Writing a record

- Record a scenario in the file of its topic, under a heading of the scenario.
  - Open the scenario with a sentence of what kern-orm does.
  - Give each project an item with its name, a link to its issue, documentation, or source, and a verdict.
  - State what the project does in the scenario, such as the SQL that it builds or the rows that a query returns, rather than a judgment such as a loss of data.
  - Cite an issue or a pull request only for behavior of the listed version, such as a missing feature, never for a defect that the listed version fixes.
- Name another project, here and in decisions/, as [Projects](#projects) lists it, without a link to the project and without a version unless it differs from the listed one; write a record of an issue or a pull request in the past tense.
  List a new project there with its link and the version you checked.
- Do not link comparison/ back to architecture/.
- Also record a scenario that another project fails while kern-orm covers it in a comment of the test that checks the scenario, such as `// Orchid ORM let a user OR bypass the relation condition: <issue URL>`.
- Keep a capability that another project has and kern-orm lacks, such as `narrowAllTypes` of Orchid ORM, in the item of [backlog/](../backlog/README.md) that would add it, and move it here when the item is deleted.
- Update the matrix of [docs/orm/comparison.md](../docs/orm/comparison.md), whose rows `docs/.vitepress/comparison/orm.ts` defines, when a record that a row links changes, as [user documentation](../development/user-documentation.md#site) describes.
- Add a scenario worth comparing that the topics do not cover yet to [Scenarios to compare](#scenarios-to-compare).
