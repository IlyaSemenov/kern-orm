# Native parameters of the postgres.js driver

The Orchid adapter runs its statements on the built-in postgres.js driver of kern-db, through the `getNativeParameters` option of `postgresJsDriver`.
The option returns, for a statement, the values that postgres.js serializes itself; the driver sends the text parameters of every other statement.
The driver does not know Orchid: the adapter keeps the field of its statements and the function that reads it.

A dedicated Orchid driver, beside the built-in one, would keep the built-in driver free of any option for another query builder.
It would duplicate the transport, the classification of errors, the codes of unsent statements, and the lifecycle of the built-in driver, which would drift apart whenever either changes.

A field of `SqlStatement` with native values that every driver honors would let a query builder pass them without choosing a driver.
It would make a contract of every driver, also of node-postgres and of custom drivers, of what only one query builder of postgres.js values needs.

Exporting the classification of errors and the codes of unsent statements of the postgres.js driver would let the adapter build its driver from them, but would still duplicate its execution and lifecycle, with a larger public API than one option.

The integration supports postgres.js only.
