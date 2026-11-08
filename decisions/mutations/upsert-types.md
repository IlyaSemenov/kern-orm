# Types of `upsert`

The state of a query of `find` and `findBy` is an interface of every part of the state with the part `foundKey` of the columns of the key, which `upsert` reads, and the values of `upsert` are a mapped type of their own.

```ts
interface FoundState<S extends SelectQueryState, K extends string>
  extends SelectQueryState, FoundKey<K> {
  readonly table: S["table"]
  // … every other part of `S`
  readonly rows: OneRow<FilteredStateRows<S>>
  readonly guaranteed: false
}

interface FoundKey<K extends string> {
  readonly foundKey: K
  readonly [foundKeyVariance]: { readonly [C in K]: true }
}

type UpsertValues<T extends AnyTable, K extends string> = {
  readonly [C in keyof T["columns"] as C extends OptionalColumnKey<T> | K ? never : C]: ColumnValue<
    T,
    C
  >
} & {
  readonly [C in Exclude<OptionalColumnKey<T>, K>]?: ColumnValue<T, C> | undefined
}
```

The columns themselves make the states of different keys unrelated, so a union of queries of `find` and `findBy` by different keys, such as `flag ? db.user.find(id) : db.user.findBy({ email })`, rejects the methods that change the state, such as `select` and `get`, as a union of other [states](../queries/state-changing-methods-on-unions.md) does.
Optional members of the columns beside a required member, which make the states of different keys assignable to each other, take such a union, but make a query of one key assignable to a query of another, so `upsert` types its values by a key other than that of the query, and only its check at runtime rejects them:

```ts
type FoundColumns<K extends string> = { readonly [C in K]?: true } & { readonly [foundMark]: true }

let query = db.user.find(id)
query = db.user.findBy({ email }) // compiles
await query.upsert({ email, name }) // compiles, and rejects at runtime
```

The other alternatives look simpler, but cost more instantiations ([benchmark](../../benchmarks/types/queries.bench.ts)):

- `ChangeState` with the part, as the states of other methods change, costs `find` and `findBy` about 36% more than the interface, which costs them 16% to 19% less than even `ChangeState` without the part:

  ```ts
  type FoundState<S extends SelectQueryState, K extends string> = ChangeState<
    S,
    { rows: OneRow<FilteredStateRows<S>>; guaranteed: false }
  > &
    FoundKey<K>
  ```

- A parameter of `InsertValues` for the columns that a record does not give, so that one type gives the values of `insert` and of `upsert`, costs every insert about 4% more:

  ```ts
  type InsertValues<T extends AnyTable, Omitted = never> = {
    readonly [
      K in keyof T["columns"] as K extends OptionalColumnKey<T> | Omitted ? never : K
    ]: ColumnValue<T, K>
  } & {
    readonly [K in Exclude<OptionalColumnKey<T>, Omitted>]?: ColumnValue<T, K> | undefined
  }
  ```

- `Omit` of `InsertValues` costs `upsert` about 23% more:

  ```ts
  type UpsertValues<T extends AnyTable, K extends string> = Omit<InsertValues<T>, K>
  ```
