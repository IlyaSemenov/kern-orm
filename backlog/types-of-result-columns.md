# Types of result columns

Checking once per result column, rather than once per value, that the PostgreSQL type of a column, its OID in `columns` of the result of a driver, is one that the type of its field decodes, so that a field whose declared type no longer matches its column fails with `ResultDecodeError`, such as a column changed from `boolean` to `text` without a change of its table definition, whose `true` and `1` the decoder of another type may read as a value.

- Preliminary decision: a check in the decoding of flat results, against the OIDs that a type accepts, which a type declares beside its cast type; a type that declares none is not checked, such as a custom type of an extension.
- Decide how a type tells the OIDs of the types that it reads in place of its own, which PostgreSQL returns for valid queries:
  - the `numeric` average and the `bigint` sum of `smallint` and `integer` values, which the type of the argument decodes;
  - the common type of the operands of a function, which the type of the first operand reads;
  - the result of a read expression;
  - `text` of a `varchar` or a `char`, and `smallint`, `integer`, and `bigint` of one another.
- Decide how to resolve the OIDs of types that have none fixed, such as enums, domains, and the types of extensions like `vector`, whose OIDs differ by database: a query of `pg_type` once per connection or per database, or no check of them.
- Nested rows packed as JSON carry no OIDs of their fields, so their values are not checked.
- Fake and recording drivers return a fixed OID, such as `25` of `text` for every column, so they must return the OIDs of the columns, or the check must be skippable for them.
