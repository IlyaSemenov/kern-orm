# Parameters of casts bound once in a statement

A statement binds the parameter of a cast once, under one placeholder wherever it repeats the cast: of `param(type, value)` of the ORM and of `param` of a fragment of the database layer, in `query` and `queryOn` of the layer as in every statement of the ORM.
Every other parameter binds at each place.
The binder looks a cast up by the identity of its node or fragment, so two calls of `param` with the same value are two parameters; it keeps the first cast apart and creates a map of the others at the second.

For a time that a statement reads at several places:

```ts
const now = param(t.timestamptz, new Date())
await database.query`
  UPDATE job SET locked_at = ${now}, lease_until = ${now} + interval '1 minute'
  WHERE job.run_at <= ${now}
`
```

The statement binds the parameter of `now` once:

```sql
UPDATE job SET locked_at = ($1::timestamptz), lease_until = ($1::timestamptz) + interval '1 minute'
WHERE job.run_at <= ($1::timestamptz)
```

For fields grouped by buckets of positions, whose condition reads the key through its field:

```ts
const size = param(t.integer, 10)
const buckets = await db.field
  .select(field => ({
    bucket: sql(t.integer)`${field.position} / ${size}`,
    fieldCount: count(),
  }))
  .groupBy((field, selected) => selected.bucket)
  .having((field, selected) => selected.bucket.gt(0))
```

The compiler binds the parameter of `size` once, as `$1` at both places, which PostgreSQL requires of an expression in `HAVING` for the key of `GROUP BY`:

```sql
SELECT "form_field"."position" / ($1::integer) AS "bucket", count(*) AS "fieldCount"
FROM "form_field" AS "form_field"
GROUP BY 1
HAVING ("form_field"."position" / ($1::integer)) > $2
```

- Binding every parameter at each place takes no lookup, but PostgreSQL rejects a selected expression that needs to match a key of `GROUP BY` written again with a parameter of its own, such as `SELECT position / $1 ... GROUP BY position / $2`, while `GROUP BY 1` takes it, and a value passed once and read at several places requires a statement built for it, such as with a common table expression, `WITH input AS (SELECT ${param(t.timestamptz, now)} AS now)`.
- Binding the parameter of a cast once only in a query of groups takes the lookup only there, but the same template gives different statements through `$query` of a `Db` and `query` of a `Database`.
- The lookup leaves the scenarios of the benchmark without casts unchanged within the noise, and makes the compilation of a statement of 1000 casts, each a parameter of its own, slower: `IN` of 1000 `param(t.uuid, id)` of the ORM by 34 to 42% on Bun and 55 to 63% on Node.js, and a query of SQL text of 1000 `param` fragments by 50 to 62% on Bun and 45 to 54% on Node.js, against binding each at its place ([benchmark](../../benchmarks/runtime/preparation.bench.ts)).
- Keeping the first cast apart from the map, against creating the map at the first cast, makes compiling a statement of one `param` at three places faster by 3% for a query of the ORM on Bun and Node.js, and for a query of SQL text by 7% on Bun and 10% on Node.js, and changes the statements of 1000 casts within the noise.
  Against binding at each place, the map created at the first cast made the statement of one `param` at three places of the ORM slower by 2% on Bun and Node.js, and that of SQL text by 4% on Bun and within the noise on Node.js.
- A map of placeholders for every parameter of every statement, which would bind a bare parameter once too, makes compiling an insert of 1000 records 32 to 69% slower, `IN` of 1000 values 56 to 74% slower, and a small select about 5% slower.
  A bare parameter takes its type from its place, so one placeholder could also convert its value by the type of another place.
