# Transaction control in Orchid SQL rejected by its leading keywords

The Orchid adapter rejects a statement of SQL text that begins or ends a transaction or works with savepoints, such as `COMMIT` of `$query`, before it runs, by its leading keywords after whitespace, nested comments, and empty statements.
The keywords are `BEGIN`, `START`, `COMMIT`, `END`, `ROLLBACK`, `ABORT`, `SAVEPOINT`, `RELEASE`, and `PREPARE TRANSACTION`.
`PREPARE` of a prepared statement named `transaction` is followed by `AS` or a list of parameter types rather than the string constant of `PREPARE TRANSACTION`, and runs.
The driver runs one statement per text with the extended protocol, and PostgreSQL starts each of these statements with its keywords, so the keywords recognize it without a parser of SQL.
A `COMMIT` of a procedure or a `DO` block is not such a statement, but PostgreSQL rejects it in a transaction block, which every transaction of Kern is.
Statements that change settings of a transaction or a session, such as `SET TRANSACTION`, are not rejected: the isolation level also changes through `SET transaction_isolation`, and settings such as `statement_timeout` through `SET` of their names and `set_config`, so settings stay with the author of the SQL, as in any statement of SQL text.

Leaving SQL text unchecked, as `database.query` of kern-db does, would cost no scan of each statement, but a `COMMIT` in a transaction of Kern would commit its changes, which the rollback of the transaction would not undo.
Checking the status of the transaction of the connection after the statement, which the driver reads, would recognize a transaction that a statement left, but only after the statement has committed or rolled back the work, and not a `COMMIT AND CHAIN`, which starts the next transaction at once.
A check in `Database.execute` of kern-db would protect every query builder and its own queries of SQL text, but would change the contract of kern-db and scan every statement of every application.
