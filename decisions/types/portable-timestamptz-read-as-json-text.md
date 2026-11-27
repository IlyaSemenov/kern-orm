# `timestamptzPortable` read as the JSON text of its UTC timestamp

A library that runs on the connections of an application, such as the scheduler of kern-jobs, cannot require the `DateStyle` that `timestamptz` decodes, and must bind a point in time that one transaction reads in another, with its microseconds.
`timestamptzPortable` is a `timestamptz` whose [read expression](read-expression-of-a-type.md) writes the JSON text of the timestamp of the value in UTC:

```sql
SELECT (to_jsonb(run_at AT TIME ZONE INTERVAL '00:00') #>> '{}') FROM job
-- 2026-01-15T07:00:00.1234, 0044-03-15T12:00:00 BC, 294276-12-31T23:59:59.999999, infinity
```

JSON writes a timestamp in ISO 8601 whatever `DateStyle` is, and the conversion to UTC leaves no offset of `TimeZone` to write.
The text keeps every microsecond, the whole range of `timestamptz`, and both infinities, and it is `NULL` only for `NULL`.
`timestamptzPortable` decodes it to the strings of `timestamptz`, such as `2026-01-15T07:00:00.123400Z`, `-000043-03-15T12:00:00.000000Z`, and `infinity`, which bind as the same instant under any `DateStyle`.

The expression costs PostgreSQL more than the text output of `timestamptz`.
In PostgreSQL 18.4, in a session of `TimeZone = 'UTC'`:

- In psql, over a million values of a temporary table, `sum(length(...))` of the expression took 1.4 times as long as that of `value::text`, and the conversions alone, beyond the scan and the sum, 1.5 times.
- Through kern-db with postgres.js on Bun, on the same machine, a statement of 10 such columns took 1.5 to 1.9 times as long to return its rows, for 1000, 10000, and 100000 rows, and 1.6 to 1.7 times with decoding them.
- Returning and decoding rows with two such columns out of ten took 1.03 to 1.05 times as long, for 1000 and 10000 rows.

In a session of another time zone, `timestamptz` converts each value by its offset, and the statement of 10 columns took about two thirds as long with `timestamptzPortable` as with `timestamptz`, measured with `AT TIME ZONE 'UTC'`, which costs a little more than a zero interval.
An application that chooses the settings of its connections and whose SQL does not depend on the time zone of the session gets the speed of `timestamptz` back with `TimeZone` set to `UTC` in the connection options of its client.

So `timestamptzPortable` is a type of its own for code that cannot choose the settings of its connections, rather than how `timestamptz` reads, which would cost every query that returns a `timestamptz` in every application that sets `DateStyle` itself, and change the SQL of those queries, and of every statement written by hand that returns one.
Its name derives from `timestamptz`, so that it reads as a variant of that type rather than as the type of points in time to prefer.

The alternatives:

- `instant` would be a shorter name of the values that the type returns, rather than of its SQL type.
  But it would read as the type of points in time to prefer over `timestamptz`.
- `AT TIME ZONE 'UTC'` would read more plainly than a zero interval.
  But a POSIX `TimeZone`, such as the common mistake `UTC+05`, gives the abbreviation `UTC` its own offset: with `TimeZone = 'UTC+05'`, `AT TIME ZONE 'UTC'` returned a time 5 hours before the UTC time.
- `extract(epoch from value)`, decoded as exact decimal seconds in kern-db, would read a number that no setting changes, with calendar arithmetic in kern-db rather than parsing.
  But in PostgreSQL 18.4 it rounded the largest finite instant, `294276-12-31 23:59:59.999999Z`, up to `9224318016000.000000`, a value a microsecond later that `timestamptz` cannot hold, so the decoded value would not be the instant.
- `to_char(value AT TIME ZONE INTERVAL '00:00', 'YYYY-MM-DD"T"HH24:MI:SS.US')` would write six fractional digits, which would need no padding.
  But in PostgreSQL 18.4 it returned SQL `NULL` for both infinities, and a read expression must be `NULL` only for `NULL`; telling the infinities apart would write the value twice in the expression.
- A second decoder of `timestamptz` for each `DateStyle` would need no expression and no type of its own.
  But a decoder reads only the text, so it could not tell the field order of `DMY` from that of `MDY` in the `SQL` style, which writes the month as a number, nor read the time zone abbreviations that the `SQL`, `Postgres`, and `German` styles write, such as `LMT`, as offsets without a database of time zones.
