# After-commit hooks

Callbacks that run after the current transaction commits, such as sending the notifications of the changes it made, as `$afterCommit` of Orchid ORM 1.78.47 does ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/transactions.md#aftercommit)).
A hook belongs to the level that registers it: rolling the level back discards it, releasing the level passes it to the enclosing level, and it runs after the outermost commit, so that it runs only for the work that the commit keeps, whichever `Db` of the database registers it, as the [motivation](../architecture/README.md#motivation) requires.

- Decide what a hook registered outside a transaction does; Orchid ORM runs it on the next microtask.
- Decide how a failure of a hook is reported once the transaction has committed; Orchid ORM leaves it to `uncaughtException` or `unhandledRejection`.
- The outermost transaction of code under test is a nested level of the test level, which never commits: decide whether its hooks run when it is released, as in production, and whether the rollback of the test level waits for them, as in Orchid ORM ([docs](https://github.com/romeerez/orchid-orm/blob/3302410cb48b02e7c65dec837862bc33250254fd/docs/src/guide/transactions.md#after-commit-hooks-in-tests), [orchid-orm#822](https://github.com/romeerez/orchid-orm/pull/822)), so that their queries roll back with the test.
  A test level does not count as a transaction for [joining](../architecture/transactions.md#joining).
