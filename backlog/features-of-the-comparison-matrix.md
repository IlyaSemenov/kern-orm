# Features of the comparison matrix

- Record how the other projects handle the features of the `unknown` cells of the matrices of [docs/orm/comparison.md](../docs/orm/comparison.md) and [docs/migrations/comparison.md](../docs/migrations/comparison.md), as [Writing a record](../comparison/README.md#writing-a-record) requires, and fill them.
  For a feature that the documentation of a project states plainly, its documentation is evidence enough.
- Add the rows of common features, such as composite keys, found by going through the pages of the site and the main sections of the documentation of each project.
- Record whether the listed versions of the migrators of the matrix of migrations have the features of kern-migrations that no record checks for them, and add their rows: rolling back and redoing migrations, the same migrations applied to any schema, such as of each tenant, migrations of a package in a table of their own, and rolling back a squashed history.
  Check in the listed versions the past issues of rake-db, Drizzle ORM, and Kysely that [comparison/migrations.md](../comparison/migrations.md) records, such as of locks and of migrating inside a transaction, for the cells of their rows.
- Check in the listed versions the guarantees of kern-orm that comparison/ records only as past issues of Orchid ORM, and add their rows: empty groups of conditions and empty lists of `IN`, updates and deletes of every row, and late work of a finished test.
- Record the requests of features that the maintainers of a project declined, such as of Orchid ORM, which the matrix shows as `declined`.
- Add a matrix of kern-db once comparison/ covers it, against Slonik and against a client of PostgreSQL used directly, and link it with the other matrices by their lines of links.
