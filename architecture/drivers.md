# Drivers

- **Driver** (separate packages): transport, pooling, and connections.
  It sends parameters as text without declared types and returns result values as text, so that types alone define how values are represented and the statement text alone determines the types of parameters.
  It returns the number of rows of the command tag beside the rows, which a mutation without `RETURNING` resolves to, and the names of the result columns, which a query of SQL text reads its fields by.
  It also executes a script of several statements without parameters, which a statement with parameters cannot hold, since PostgreSQL takes several statements only in a query of its simple protocol; it ignores the results of a script.
  A connection runs its statements and scripts one at a time in the order of calls, so a statement sent before `COMMIT` or `ROLLBACK` completes before it.
  The coordinator releases a transaction connection whatever the outcome, passing the failure of `BEGIN`, `COMMIT`, or `ROLLBACK`; the driver returns such a connection to its pool only once it is idle, and never returns a lost one.
  Closing a driver waits for the transactions on its reserved connections to end, including those still waiting for a connection, and then closes the connections.

## postgres.js

The driver requires postgres.js 4 and leaves the release and closing contracts to it:

- It releases a connection without inspecting the failure: postgres.js returns a released connection to the pool once its statements complete and only when it is idle, closes one left in a transaction, and has already closed a lost one.
- Closing it calls `sql.end()` at once: `sql.end()` waits for the reserved connections to be released and gives the pending `sql.reserve()` calls a connection first; statements already sent to the pool complete, and later ones reject.
- It sends every parameter, including `null`, with OID 705 (`unknown`), which postgres.js sends as it is instead of serializing it by the type PostgreSQL describes, and reads the bytes of text-format results through `.raw()` instead of parsing them.
- It sends a statement with the extended protocol also without parameters, `simple: false` of `unsafe`, since postgres.js would send it with the simple protocol, which runs several statements of one text, such as of `$query`; the extended protocol rejects them before running any.
- It executes a script with `.simple()` of `unsafe` without parameters, and reads its results through `.raw()`, so that the parsers of the client never run on them.
