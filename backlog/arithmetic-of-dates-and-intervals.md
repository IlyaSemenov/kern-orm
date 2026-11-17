# Arithmetic of dates and intervals

Operators of `+` and `-` of dates, times, and intervals, such as of the time a token expires at, which a query writes as ``sql(t.timestamptz)`${token.createdAt} + ${ttl}::interval` ``.

- Unlike the [arithmetic operators](../architecture/types.md#arithmetic-operators) of numbers, the operand and the result differ from the type of the expression, so each operator needs a signature of its own types:
  - `timestamptz + interval` and `timestamptz - interval` give `timestamptz`, and `timestamptz - timestamptz` gives `interval`, and `timestamp` likewise;
  - `date + integer` and `date - integer` give `date`, `date - date` gives `integer`, and `date + interval` gives `timestamp`;
  - `interval + interval` and `interval - interval` give `interval`, and `interval * number` and `interval / number` give `interval`.
- Decide the names, such as `add` with an operand of another type, or `plus` and `minus` apart from those of numbers, and how a plain operand of `interval`, a string, is cast so that PostgreSQL does not read it as the type of the expression.
- Measure the cost of the signatures with `bench:types`.
