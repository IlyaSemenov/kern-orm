# Parameters bound once only in queries of groups

A query of groups binds the parameter of a cast node once, and every other parameter binds at each place.

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

The compiler binds the parameter of `size` once, as `$1` at both places:

```sql
SELECT "form_field"."position" / ($1::integer) AS "bucket", count(*) AS "fieldCount"
FROM "form_field" AS "form_field"
GROUP BY 1
HAVING ("form_field"."position" / ($1::integer)) > $2
```

The same expression selected and filtered in a query without groups binds it at each place:

```sql
SELECT "form_field"."position" / ($1::integer) AS "bucket"
FROM "form_field" AS "form_field"
WHERE ("form_field"."position" / ($2::integer)) > $3
```

- A map of placeholders for every parameter of every statement, which would bind it once there too, makes compiling an insert of 1000 records 32 to 69% slower, `IN` of 1000 values 56 to 74% slower, and a small select about 5% slower.
- Binding only the casts of queries of groups slows three of the scenarios of the benchmark, which have no groups, by 1.0 to 1.3% and changes the others within the noise ([benchmark](../../benchmarks/runtime/preparation.bench.ts)).
