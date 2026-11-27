# Instants independent of DateStyle

The kern-jobs scheduler reads a cursor and the transaction clock as epoch seconds so it can run on an application's pool with any `DateStyle`.
It needs to bind the instant from the first transaction in the second, even when it rounds to a minute for scheduling.
The built-in [`timestamptz`](../docs/database/types.md) already reads and writes UTC strings with six fractional digits under ISO output.
The missing feature is a reusable type that preserves that precision across session settings.

- Prototype an opt-in `timestamptz` type using the existing [read expression](../decisions/types/read-expression-of-a-type.md) to select a session-independent representation for returned values.
  Keep comparisons and ordering on the timestamp itself.
  Generated projections can apply the expression to both a column and a clock expression, while handwritten SQL must select it explicitly.
- Prefer the built-in type's UTC string contract so the returned value can be bound directly through a text parameter.
  Compare formatting UTC in PostgreSQL with decoding exact decimal epoch seconds in kern-db.
  Avoid a conversion through a JavaScript `number` of epoch seconds or a `Date` on the round trip.
  Decide the public name and whether the reusable definition warrants a built-in alongside the documented custom type.
- Verify that a value read in one transaction compares equal to the original when bound in another under different `DateStyle` and `TimeZone` settings.
  Cover a value one microsecond before the epoch, a minute boundary, extended years, infinities, and nullable fields, including a nested projection.
