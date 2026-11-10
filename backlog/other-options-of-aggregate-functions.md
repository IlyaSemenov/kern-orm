# Other options of aggregate functions

Options of the [aggregate functions](../architecture/types.md#aggregate-functions) beside `filter` and the `orderBy` of `stringAgg`, which SQL fragments cover until then: `distinct` of any aggregate, ordered-set aggregates as `WITHIN GROUP`, and window functions as `OVER`.
Orchid ORM 1.78.47 takes `distinct`, `order`, `filter`, `filterOr`, `withinGroup`, and `over` ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/aggregate.md)).
