# Features of the comparison matrix

- Record how Drizzle ORM, Kysely, Prisma ORM, and Orchid ORM handle the features of the `unknown` cells of the matrix of [docs/orm/comparison.md](../docs/orm/comparison.md), as [Writing a record](../comparison/README.md#writing-a-record) requires, and fill them.
  For a feature that the documentation of a project states plainly, its documentation is evidence enough.
- Add the rows of common features, such as composite keys, found by going through the pages of the site and the main sections of the documentation of each project.
- Check in the listed versions the guarantees of kern-orm that comparison/ records only as past issues of Orchid ORM, and add their rows: empty groups of conditions and empty lists of `IN`, updates and deletes of every row, and late work of a finished test.
- Record the requests of features that the maintainers of a project declined, such as of Orchid ORM, which the matrix shows as `declined`.
- Add a matrix of kern-db once comparison/ covers it, against Slonik and against a client of PostgreSQL used directly, and link the matrices of the pages to each other.
