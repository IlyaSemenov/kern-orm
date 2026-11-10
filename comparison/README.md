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
- [rake-db-testing](https://github.com/IlyaSemenov/rake-db-testing) 0.3.0.
- [Slonik](https://github.com/gajus/slonik) 49.13.0.
- [Django](https://github.com/django/django) 6.0.10.
- [node-pg-migrate](https://github.com/salsita/node-pg-migrate) 9.0.0.
- [Rails](https://github.com/rails/rails) 8.1.4.1, with its migrations of Active Record.

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

- Related records in one statement.
- Ambient transactions.
- Tables and queries reused across PostgreSQL schemas.
- Tests in transactions that roll back.
- Errors of drivers classified as a statement that PostgreSQL rejected or a lost connection, across clients.
- A connection returned to the pool in a transaction, such as after a failed `COMMIT` or a `BEGIN` sent outside a transaction.
- A transaction whose connection fails: whether it may have been committed, and whether it commits after its callback caught the error.
- The isolation level of a nested transaction, which PostgreSQL sets only for a whole transaction.
- Statements that PostgreSQL rejects in a transaction block, such as `CREATE INDEX CONCURRENTLY`, on one connection with its search path.
