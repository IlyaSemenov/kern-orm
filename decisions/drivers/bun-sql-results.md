# Text results of Bun SQL

The Bun SQL driver uses an unnamed statement and reads raw fields as UTF-8 strings, preserving SQL `NULL` as `null`.
This gives `database.execute` the PostgreSQL text it exposes and lets a selected type apply its own decoder to that same text.

Bun's native result conversion saves work for selections such as integers and Booleans.
For arbitrary SQL it can discard information before the driver knows which decoder needs it.
Bun selects raw or native decoding for the whole result and exposes no per-column format choice.
For example, SQL `NULL` and the JSON value `null` can both arrive as JavaScript `null`, while `jsonbWithJsonNull` distinguishes them.
Converting a parsed timestamp back from a JavaScript `Date` also loses sub-millisecond precision.
With named preparation, raw fields may arrive in binary depending on their type and the execution, so simply reading every buffer as UTF-8 would corrupt values.

## Measurements

The [benchmark](../../benchmarks/suites/bun-sql-results.ts) selects an integer, a Boolean and a short text field per row on local PostgreSQL 18.4 with Bun 1.4.5.
Each query runs alone on a pool with one connection.
Run `bun run --cwd benchmarks bench bun-sql-results` five times to collect the timings.
Each of five fresh processes runs 30 warm-up rounds and 60 measured rounds in rotating order.
For each result size, each ratio compares a variant's median time with the native unnamed median in the same process.
The table shows the median of those five ratios.

|   Rows | Native Bun prepared | Native Bun unnamed | Bun raw as strings | Bun raw + Kern codecs | Bun reserved + Kern codecs | Kern Bun SQL query | Kern postgres.js query |
| -----: | ------------------: | -----------------: | -----------------: | --------------------: | -------------------------: | -----------------: | ---------------------: |
|      1 |               0.84× |              1.00× |              0.94× |                 0.94× |                      1.06× |              1.30× |                  1.47× |
|    100 |               0.89× |              1.00× |              1.07× |                 1.09× |                      1.12× |              1.31× |                  1.43× |
| 10,000 |               1.09× |              1.00× |              1.32× |                 1.40× |                      1.40× |              1.64× |                  1.75× |

- **Native Bun prepared** uses Bun SQL's default named prepared statements and native decoding to return `id` as a number, `even` as a Boolean and `label` as a string.
- **Native Bun unnamed** uses the same native decoding with `prepare: false` and provides the 1.00× baseline for each row count.
- **Bun raw as strings** reads unnamed results with `.raw()`, converts each buffer to a UTF-8 string and returns a record with three string fields per row.
- **Bun raw + Kern codecs** also decodes the integer and Boolean fields and passes the text field through the Kern text codec.
- **Bun reserved + Kern codecs** runs the same query and decoding code with a `reserve()` and `release()` per query.
- **Kern Bun SQL query** builds a typed query with `database.query` and `.select(fields)`, executes it through `bunSqlDriver` and decodes the text rows with the selected Kern types.
- **Kern postgres.js query** executes the same typed query through `postgresJsDriver`, with postgres.js reading the PostgreSQL text and Kern decoding the same three fields.

Compared within each process, reserving the connection added a median of 11% for one row and 4% for 100 rows.
At 10,000 rows, four runs differed by less than 1% and reservation took 6% longer in the fifth.
Reading 10,000 rows as strings took 1.32× the native unnamed time, and the full Kern Bun SQL query, including query construction and decoding, took 1.64×.
