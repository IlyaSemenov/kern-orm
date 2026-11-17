# Converting results

## Result column metadata

Kern returns result columns as readonly objects with `name` and PostgreSQL type OID in `type`.

- Bun SQL, same: PostgreSQL results expose `columns` as objects with `name` and `type`, alongside the source table OID in `table` and column number in `number` ([documentation](https://bun.com/blog/release-notes/bun-v1.4.4#result-columns-and-result-statement)).

## Driver parsing

Kern drivers return PostgreSQL text values for the query's column codecs to decode.

- Orchid ORM at commit `381b51ffbb85efd6e4defd4170ba79f360f2a9f1`, differs: its node-postgres adapter uses pg parsers except for dates, timestamps, timestamp-with-time-zone values, circles, and points, which it leaves as text ([source](https://github.com/romeerez/orchid-orm/blob/381b51ffbb85efd6e4defd4170ba79f360f2a9f1/packages/pqb/src/adapters/node-postgres.ts)).
  A bridge that uses unmodified pg parsers changes these legacy result representations.
- Postgres.js, differs: a query's `.parsers()` accepts parsers by result OID or a function of each column; returning `null` keeps that column as PostgreSQL text.
  This controls results, not parameter serialization ([documentation](https://github.com/porsager/postgres/blob/v4.1.0/README.md#parsers-for-one-query)).

## Legacy driver representations

Kern decodes the text values returned by either driver through its column types, rather than through the driver's value parsers.

- Orchid ORM 1.78.59 with pqb 0.73.48, differs: its postgres.js adapter returns timestamp array elements as strings with microsecond precision and parses intervals with zero-valued fields included; node-postgres array parsers return timestamp elements as `Date` values, and its interval parser omits zero-valued fields.
  A read-only comparison with postgres.js 4 and pg 8 checked `ARRAY[TIMESTAMPTZ '2026-01-02 03:04:05.123456+00']` and `INTERVAL '1 day 02:03:04'` ([postgres.js adapter source](https://github.com/romeerez/orchid-orm/blob/381b51ffbb85efd6e4defd4170ba79f360f2a9f1/packages/pqb/src/adapters/postgres-js.ts), [node-postgres adapter source](https://github.com/romeerez/orchid-orm/blob/381b51ffbb85efd6e4defd4170ba79f360f2a9f1/packages/pqb/src/adapters/node-postgres.ts)).

## Parameter serialization

Kern's text statement contract takes parameters already encoded as PostgreSQL text and lets the statement determine their types; `database.execute` passes the statement object to the driver unchanged, so the driver of the Orchid adapter takes the JavaScript values of Orchid from a field of its own and lets postgres.js serialize them.

- Orchid ORM 1.78.60 with pqb 0.73.49 and postgres.js 4.1.0, differs: postgres.js resolves input types through PostgreSQL and chooses serializers by those types with its default `infer: false`.
  A JavaScript array can become JSON or a PostgreSQL array, and a JavaScript string is JSON-quoted for a JSON parameter but not for text.
  The interop executor's PostgreSQL comparisons check these distinctions, including `SELECT ($1::jsonb)->>0`, whose input and result types differ ([serialization source](https://github.com/porsager/postgres/blob/v4.1.0/src/connection.js), [codecs](https://github.com/porsager/postgres/blob/v4.1.0/src/types.js)).
- Postgres.js 4.1.1, differs: for a parameter without a declared type, it describes the statement on the connection that runs it and serializes the value by the type that PostgreSQL resolves, unless every such value is `null` or a finite number and the client has no custom serializer, which it sends untyped in the same round trip ([connection source](https://github.com/porsager/postgres/blob/v4.1.1/src/connection.js)).
  Its public query API exposes `.describe()` as a separate operation, without a per-query callback that encodes parameters from the described OIDs before binding that same statement.
  Its `types` configuration chooses serializers for the whole client ([query API](https://github.com/porsager/postgres/blob/v4.1.1/types/index.d.ts)).
- node-postgres, differs: a submitted `Query` can control Parse, Describe, Bind and Sync within the client's queue.
  Its default query uses JavaScript-value serialization; a custom query implementation can wait for parameter descriptions before binding ([query lifecycle](https://github.com/brianc/node-postgres/blob/pg%408.23.1/packages/pg/lib/query.js)).

## Codec registration

Kern's drivers leave decoding to query codecs and return text independently of the underlying client's configured parsers.

- Orchid ORM 1.78.60 with pqb 0.73.49, differs: its postgres.js adapter supplies its own `types` object after spreading the caller's configuration, replacing caller-supplied type definitions.
  Its configured postgres.js client exposes parser and serializer registries, including array and domain codecs resolved from the type catalog ([adapter source](https://github.com/romeerez/orchid-orm/blob/381b51ffbb85efd6e4defd4170ba79f360f2a9f1/packages/pqb/src/adapters/postgres-js.ts), [postgres.js registry source](https://github.com/porsager/postgres/blob/v4.1.0/src/types.js)).
  The interop executor compares custom scalar registry codecs and catalog-loaded enum, domain and composite arrays against that native adapter.

## Counts of commands without rows

Kern returns `count: 0` when a command has no count, including DDL and empty SQL.

- Orchid ORM 1.78.60 with pqb 0.73.49 and postgres.js 4.1.0, differs: the adapter passes through postgres.js's `count`, which is `null` for those commands and zero for a zero-row mutation, despite Orchid declaring `rowCount` as a number ([adapter source](https://github.com/romeerez/orchid-orm/blob/381b51ffbb85efd6e4defd4170ba79f360f2a9f1/packages/pqb/src/adapters/postgres-js.ts), [command tag parsing](https://github.com/porsager/postgres/blob/v4.1.0/src/protocol.js)).

## `map` of a `NULL` value

`map` converts each row that a query returns, so it calls its callback with `null` for a `NULL` value, such as of an aggregate without rows, and not for a missing row.

- Orchid ORM, differs: it does not call `map` for `null` of `sum` and `avg`, and `transform` converts it there ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/query-methods.md#map)).

## Methods after `transform`

Only another `transform` applies after `transform`, since each other method would change what its callback receives.

- Orchid ORM, same: its documentation requires the same of `transform` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/query-methods.md#transform)).
