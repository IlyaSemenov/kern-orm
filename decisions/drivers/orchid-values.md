# Orchid values serialized by postgres.js

The executor of the Orchid adapter passes the JavaScript values of an Orchid statement in a field of its own of the statement, which it reads with the [`getNativeParameters` option](native-parameters.md) of the postgres.js driver, and the driver sends them to postgres.js as Orchid itself does.
postgres.js describes the parameters on the connection that runs the statement and serializes each value with the serializer of the client for the type that PostgreSQL resolves.
`database.execute` passes the statement object to the driver unchanged, which is the only contract that kern-db gives for it; `SqlStatement.parameters` stays PostgreSQL text.

An operation of kern-db that resolves the parameter types and lets its caller encode the values, `executeWithEncoder(text, encode)`, with a patch of postgres.js that calls the encoder between the description and the binding, would give every custom driver and query builder a typed, documented way to encode values by their server types.
It would also classify a failure of the encoder as a `ConnectionError` by its own contract rather than by how a driver classifies an error of its client.
It would cost a public operation of kern-db that only the adapter uses, an optional capability of the driver contract, and a patch of postgres.js that every application must install and that ties the adapter to one exact version of postgres.js.

Encoding the values by their JavaScript types before execution, as the drivers of kern-db encode text, would need no help from the driver, but it changes results: `[1, 2]` can be a JSON value or a PostgreSQL integer array, and a string parameter of JSON needs quoting while one of text does not.
Describing the statement on the pool before executing it would give the types with the API of postgres.js, but at the cost of a round trip per statement, and the description could see another search path or no temporary table of the transaction.

A value that postgres.js fails to serialize rejects with an error without a SQLSTATE, which the driver classifies as `ConnectionError`, so that a transaction that catches it still rolls back.
