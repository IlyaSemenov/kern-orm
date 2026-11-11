# Statement timeout of test transactions

An opt-in option of `createTestHelpers`, such as `statementTimeout` and `lockTimeout`, that sets `statement_timeout` and `lock_timeout` locally in every test level, pipelined with its `BEGIN` or `SAVEPOINT`, so that a statement already sent by an aborted or preempted test delays the next test for a bounded time.

- The seeds of test fixtures, such as long migrations, run without them, since the rollback of a test level resets its local settings.
- Build it on the [settings of a level](../architecture/transactions.md#settings) rather than as a separate mechanism.
- Keep it opt-in: kern-db does not know the timeouts of the test runner, and a limit that users did not set would fail slow tests whose code passes in production.
- Orchid ORM bounds the wait in the teardown instead, with `teardownTimeout` of `testTransaction.hooks`, and blocks its adapter once it is exceeded ([orchid-orm#818](https://github.com/romeerez/orchid-orm/pull/818)).
