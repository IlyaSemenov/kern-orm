# One step outside a transaction without records of progress

A step with changes outside a transaction must be the only step of its migration, and the migrator records the migration in a statement of its own after the change, with no record of progress in between.
After a failure, the next `migrate`, or `rollback` for a change of `down`, runs the change from its start, so the change must be safe to run again, such as by checking the catalog for what an earlier attempt left; a function sends several statements, such as one `CREATE INDEX CONCURRENTLY` for each partition, from one change.

## Several steps outside a transaction, run again from the start

A migration could hold several steps outside a transaction, as a migration of Django with `atomic = False`, one of node-pg-migrate with `noTransaction()`, and one of Rails with `disable_ddl_transaction!` run all their operations outside a transaction and run them all again after a failure.
A migration could then group related changes, such as the indexes of several tables.
Every step would have to be safe to run again, also a step that runs in a transaction between two others, such as a change of data, which runs again after a later step fails; one change that runs several statements gives the same grouping and keeps the requirement in one place.

## A record of the steps done

The migrator could record each step that it finishes, in a column of the table of versions or in a table of its own, so that the next call resumes after the last one.
A migration applied in part would become a state of the target that `getMigrationStatus` reports, `rollback` would undo only its finished steps, and the step that failed would still have to be safe to run again, since its record follows its change.
None of the compared migrators records the progress of a migration.

## A record of a call in progress

The migrator could record a call of `rollback` or `redo` before it starts, so that running it again continues it rather than choosing the migrations from those applied then.
It would need a table of calls, the same record for `migrate`, and a rule for a call of another version of the application that finds the record; the records that `getMigrationStatus` reads tell whether `rollback` or `migrate` completes it.
