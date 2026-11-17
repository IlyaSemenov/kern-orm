// Orchid ORM exports `Adapter` but not the types of its transaction state; they are derived from the public types of Orchid ORM, which keeps pqb out of the dependencies of the adapter.
import type { Adapter } from "orchid-orm"

/** Per-instance async storage of Orchid's logging, schema, and transaction state. */
export type AsyncStateStorage = NonNullable<Parameters<Adapter["transaction"]>[0]>

/** State that Orchid keeps in its async storage. */
export type AsyncState = Parameters<AsyncStateStorage["run"]>[0]

/** Adapter of Orchid's current transaction. */
export type TransactionAdapter = Parameters<Parameters<Adapter["transaction"]>[2]>[0]
