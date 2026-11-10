# Unions of queries of `find` and `findBy` by different keys

The state of a query of `find` and `findBy` has the columns of its key, which [`upsert`](../architecture/mutations.md#upserts) reads, so a union of queries by different keys, such as `flag ? db.user.findBy({ email }) : db.user.find(id)`, is a union of different states, which rejects the methods that change the state, such as `select` and `get` ([decision](../decisions/queries/state-changing-methods-on-unions.md)).

- A type parameter of `SelectQuery` for the key, apart from the state, would take such a union: the methods that change the state would take a query of any key and return one without a key, and `upsert` would infer the union of the keys of the union.
  It changes the `this` parameter or the result of nearly every method of a query; measure the cost with `bench:types`.
- Parts of the keys that are assignable to each other take such a union too, but type the values of `upsert` by another key ([decision](../decisions/mutations/upsert-types.md)).
