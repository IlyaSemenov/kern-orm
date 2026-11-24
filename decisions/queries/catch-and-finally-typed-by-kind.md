# `catch` and `finally` typed by the kind

`catch` and `finally` of the queries of the ORM are members typed by the kind, as `then` is: those of a bound query fit `catch` and `finally` of a Promise of its result, with the reason of a rejection typed `unknown`, and those of an unbound query are `undefined`, at runtime as well as in types.

```ts
class SelectQuery<out S extends SelectQueryState, out Kind extends SelectQueryKind = "unbound"> {
  // Chosen: an accessor typed by the kind
  get catch(): QueryCatch<S, Kind>

  // Alternative: a method of every query, which types take only of a bound one
  catch<S extends SelectQueryState, R = never>(
    this: SelectQuery<S, "bound">,
    onRejected?: ((reason: unknown) => R | PromiseLike<R>) | null,
  ): Promise<QueryResult<S> | R>
}
```

TypeScript allows calls of them on a union of bound queries of different states or classes, as on a union of Promises, such as on the query of `use(form => (single ? form.take() : form))`, which it also accepts in `await`.

A use of a helper instantiates the types of the members of its query.
By `bench:types` on TypeScript 7, with `then` as a function type written in its conditional type, before it became an [interface](bound-members-as-interfaces.md), the accessors added 44 to 80 instantiations, 3% to 9%, to each use of a helper, and 168, 6%, to the first unbound query, and nothing to the other benchmarks; the counts of the alternatives below were measured with the same `then` ([first query](../../benchmarks/types/first-use.bench.ts), [further queries](../../benchmarks/types/queries.bench.ts)).

## Methods typed by `this`

A method that does not name the parameters of the class costs less to instantiate than a conditional type of the kind: the methods added 6 to 12 instantiations, about 1%, to each use of a helper, and 55, 2%, to the first unbound query.

- An unbound query has the methods at runtime, where they throw, and types take it as a value of a type with `catch` or `finally` alone, such as `Pick<Promise<unknown>, "finally">`.
- The first type parameter of `catch` is the state, so `catch<null>(() => null)` is a type error.
- TypeScript rejects their call on a union of bound queries of different states or classes, which it accepts in `await`.

## Members that the constructor assigns

Members that the constructor assigns, as it assigns `then`, would have the types of the accessors, and add two assignments to every query that a method derives.

## Other types of the accessors

- A member of a query of either kind that names the state, such as `BoundQueryCatch<S> | undefined`, would let code call it after checking it, such as `query.catch?.(handler)`; TypeScript rejects that call of the chosen member.
  It added 436 instantiations to the first unbound query, where the member that does not name the state, as that of `then`, added 168.
- Function types written in the conditional types rather than [interfaces](bound-members-as-interfaces.md) added 70 to 96 instantiations to each use of a helper, where the interfaces added 44 to 80.
