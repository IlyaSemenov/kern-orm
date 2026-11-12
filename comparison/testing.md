# Testing

## Late work of a finished test

Work that outlives its test transaction, such as of a timed-out test, rejects instead of running in the next test, and a fixture whose seed never settles closes before the next scope opens its fixture.

- Orchid ORM, fails: it ran such work in the next test or on the pool, and the rest of such a seed in the enclosing test transaction ([orchid-orm#798](https://github.com/romeerez/orchid-orm/issues/798)).

## A failed statement of a test

The next test of a fixture runs after a statement of a test fails, and a test transaction whose `SAVEPOINT` fails rejects without calling its callback, and the next one starts.

- Orchid ORM, fails: it failed every later test of the file once a statement failed in its test transaction, and never settled the start of a test transaction whose `SAVEPOINT` failed ([orchid-orm#802](https://github.com/romeerez/orchid-orm/pull/802)).

## Preempting a test transaction

A test transaction that a rollback preempts, also with a nested transaction still running, completes the statements it has sent before the rollback, and its later statements fail.

- Orchid ORM, fails:
  - it ran the later queries of a test whose savepoint an outer rollback ended in the enclosing test transaction ([orchid-orm#816](https://github.com/romeerez/orchid-orm/pull/816));
  - it preempted a test transaction whose nested transaction still ran ([orchid-orm#833](https://github.com/romeerez/orchid-orm/pull/833)), and could roll the test back to a savepoint of the same name in it rather than its own ([orchid-orm#814](https://github.com/romeerez/orchid-orm/pull/814)).

## Starts and rollbacks of test transactions

Test transactions start one after another while a preemption is held, a late rollback leaves the next fixture open, and a start aborted in the queue rejects at once without preempting the active level.

- Orchid ORM, fails:
  - it ran a start and a rollback at once and left the state of the rollback in the next test, and let a late rollback end the test transaction of the next test ([orchid-orm#809](https://github.com/romeerez/orchid-orm/pull/809)) or route its queries to a rolled back one ([orchid-orm#815](https://github.com/romeerez/orchid-orm/pull/815));
  - it rejected a cancelled start only in its turn, behind the rollback of a test whose statement still ran ([orchid-orm#812](https://github.com/romeerez/orchid-orm/pull/812)).

## Requests of browser tests to a running server

The requests that a browser test sends to a server run in a test transaction that the server opens and rolls back for the test, on one connection: their transactions run one at a time as savepoints, and each of their statements outside a transaction runs in a savepoint of its own.

- Rails, differs: its transactional tests pin one connection in a transaction that the threads of the server share, and it holds the lock of the connection for a whole transaction of a thread, whose nested transactions are savepoints; it runs a statement outside a transaction in the transaction of the test without a savepoint of its own ([`pin_connection!`](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/connection_adapters/abstract/connection_pool.rb), [`within_new_transaction`](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/connection_adapters/abstract/transaction.rb), [`with_raw_connection`](https://github.com/rails/rails/blob/v8.1.4.1/activerecord/lib/active_record/connection_adapters/abstract_adapter.rb)).
- Django, differs: `LiveServerTestCase` runs a server for browser tests as `TransactionTestCase` does, which truncates every table after a test instead of rolling a transaction back ([testing tools](https://docs.djangoproject.com/en/6.0/topics/testing/tools/#liveservertestcase)).
