# Native parameters of `postgresJsConnection`

The `getNativeParameters` option of the postgres.js driver for `postgresJsConnection`, so that a statement whose values postgres.js serializes, such as an `OrchidStatement` of `@kern-orm/orchid-interop`, runs in an [external transaction](../architecture/transactions.md#external-transactions) on the client of a transaction of postgres.js.

- `postgresJsConnection` sends only the text parameters, which an `OrchidStatement` leaves empty, so PostgreSQL rejects a query of Orchid with values in an external transaction of the database of `createOrchidInterop`, as [Orchid interoperability](../architecture/orchid-interop.md#execution-and-codecs) describes.
- postgres.js serializes such values with the serializers of the client that runs the statement by the types that PostgreSQL resolves on its connection, so the client of the transaction must come from a client configured with the codecs of Orchid, as the driver of `createOrchidInterop` requires.
- Take the option as the driver takes it, and share the conversion of parameters between them.
