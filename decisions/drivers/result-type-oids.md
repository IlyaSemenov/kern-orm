# Result columns as metadata objects

`DriverResult.columns` contains readonly objects with a column's `name` and PostgreSQL type OID in `type`.
The driver reads them from the client's result metadata, including when the query returns no rows.
Values remain text or `null`, so a query builder can choose its own codecs without the transport parsing them first.

## Separate arrays of names and type OIDs

Separate arrays preserve consumers of column names and need no object allocation per column when converting metadata to that shape.
Objects keep the name and type of a column together, make mismatched lengths impossible, and allow additional metadata without another parallel array.
The contract requires each type OID even from a custom driver, so adding it already requires custom drivers to change their results.

postgres.js already provides `name` and `type` together; its driver reuses that metadata through the readonly contract.
node-postgres names its OID `dataTypeID`, so its driver creates objects with the common shape.
The [driver-results benchmark](../../benchmarks/runtime/driver-results.bench.ts) measures the public drivers over prepared client results, without network or PostgreSQL, and a query that also looks up columns by name.

## Measurements

The [benchmark](../../benchmarks/runtime/driver-results.bench.ts) compares three metadata representations: names alone, separate arrays of names and OIDs, and objects.
The names-only reference is `3cab2b3`; the parallel-array variant copies each OID beside its name and uses the same string-based lookup as the reference.
Each variant is built with tsdown and measured in six fresh processes per runtime, in alternating order, with 200 ms of warm-up and at least 250 ms of measurement per scenario.
The table gives median times in microseconds, including the public driver's promise and pooling wrappers over a fake client; the decoding cases also include SQL query compilation, routing, column lookup, and text decoding.
It excludes PostgreSQL execution, network latency, and the client's wire parsing.

| Runtime         | Driver        | Work                       | Names only, µs | Parallel arrays, µs | Objects, µs |
| --------------- | ------------- | -------------------------- | -------------: | ------------------: | ----------: |
| Bun 1.4.4       | node-postgres | 16 columns, no rows        |          0.213 |               0.239 |       0.236 |
| Bun 1.4.4       | node-postgres | 128 columns, no rows       |          0.536 |               0.839 |       0.733 |
| Bun 1.4.4       | node-postgres | Decode 16 columns, one row |          0.829 |               0.853 |       0.993 |
| Bun 1.4.4       | postgres.js   | 16 columns, no rows        |          0.181 |               0.206 |       0.149 |
| Bun 1.4.4       | postgres.js   | 128 columns, no rows       |          0.482 |               0.799 |       0.155 |
| Bun 1.4.4       | postgres.js   | Decode 16 columns, one row |          1.217 |               1.240 |       1.349 |
| Node.js 24.18.1 | node-postgres | 16 columns, no rows        |          0.274 |               0.298 |       0.282 |
| Node.js 24.18.1 | node-postgres | 128 columns, no rows       |          0.494 |               0.678 |       0.597 |
| Node.js 24.18.1 | node-postgres | Decode 16 columns, one row |          1.025 |               1.051 |       1.239 |
| Node.js 24.18.1 | postgres.js   | 16 columns, no rows        |          0.204 |               0.228 |       0.180 |
| Node.js 24.18.1 | postgres.js   | 128 columns, no rows       |          0.424 |               0.599 |       0.192 |
| Node.js 24.18.1 | postgres.js   | Decode 16 columns, one row |          1.667 |               1.694 |       1.844 |

The paired confidence intervals have 96.9% coverage.
For node-postgres with 16 columns, objects versus parallel arrays on Bun, and objects versus names alone on Node.js, are inconclusive; the other comparisons in the table exclude no change.
Reusing postgres.js metadata avoids copying its column names and types; node-postgres constructs a metadata object per column.
The decoding cases include the [guarded column lookup](../sql-queries/result-column-lookup.md), whose comparison covers the choice between scans and indexing selected names.
Their measured increase over names alone is 0.13–0.21 µs for one row of 16 text fields.
These differences describe the JavaScript work measured here, not the time of a database query or an application's throughput.

Run the topic with `bun run --cwd benchmarks bench:runtime driver-results --runs 12`.

## Optional metadata

An optional type OID would let custom drivers provide only column names.
It would also make an adapter's ability to decode arbitrary SQL depend on which driver supplied the database.
Requiring it gives every driver the same execution contract and makes a custom driver that omits it fail typecheck.

## Parsing in the driver

Returning parsed JavaScript values would let the transport's parsers decode results by OID.
It would also make Kern's column codecs depend on the transport's representations and lose information before a codec sees it, such as the microseconds of a timestamp parsed into a `Date`.
OID metadata allows a builder to select its codecs while preserving PostgreSQL text for every builder.
