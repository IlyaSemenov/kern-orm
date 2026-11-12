# Database of the current context

`bindSchema` takes a function that returns the database beside the database itself, and a `Db` bound to one calls it for each statement and at the start of each transaction, session, and lock:

```ts
export const db = bindSchema(schema, () => useDatabase())

export const publishedForms = db.form.where({ published: true }).select("id", "name")
```

Without it, an application that gets its database from dependency injection wraps the `Db` in a dependency of its own only to bind it lazily, calls it at every query site, and starts a module-level query from the schema, executed with `$execute`:

```ts
export const useDb = defineDependency(() => bindSchema(schema, useDatabase()))

export const publishedForms = schema.form.where({ published: true }).select("id", "name")

await useDb().$execute(publishedForms)
```

The function must return the same database within a transaction or session, since the statements of a transaction run on its connection.
A `Db` checks it only inside the callbacks of its own `$transaction`, `$ensureTransaction`, and `$session`, also of `$ensureTransaction` that joins a transaction of the database: it keeps their database in an `AsyncLocalStorage` of its own, and a call for which the function returns another database there rejects.
That costs a `Db` bound to a function a run of the storage for each such callback and a read of it for each statement, and a `Db` bound to a database nothing.

The alternatives weigh the coverage of the check against its cost:

- Checking every transaction and session, also outside the callbacks of the `Db`, such as in a transaction of the database, of another `Db`, or of the test helpers, needs `kern-db` to expose the levels of every database in the async context, such as through one storage that every coordinator shares.
  It would catch a provider that returns another database inside a test transaction, but changes the routing of every statement of every database, a hot path, and adds a public API to `kern-db` for this check alone.
- No check leaves the rule to the documentation at no cost, but a provider that returns another database inside a transaction runs its statements outside the transaction, on the pool of the other database, without an error.
