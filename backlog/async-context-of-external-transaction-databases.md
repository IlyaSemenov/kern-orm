# Async context of the databases of external transactions

Each call of `runInExternalTransaction` of kern-db creates a database whose coordinator has an `AsyncLocalStorage` of its own, and on Node.js 24 and later the async context of the caller keeps a key of each of them, so it grows with every call in one async chain: 1000 sequential calls leave 1000 keys ([transactions](../architecture/transactions.md#external-transactions)).
Each later `run` of an `AsyncLocalStorage` in that chain, such as of every transaction, copies the context with all its keys.

- Find out why Node.js keeps the key of a storage after its `run` ends, and whether it is the frame of the caller or of the promise of the call that keeps it.
- Find a design that bounds the context without sharing the database object between calls, whose replaced members, such as `execute`, and saved references would cross into another call, such as a storage that every database of the calls shares with a check that a statement runs in its own call.
