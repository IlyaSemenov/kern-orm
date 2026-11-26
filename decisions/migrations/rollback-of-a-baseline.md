# Rolling back a baseline

A call that undoes every migration of a target undoes the migrations that a baseline replaces together, by the `down` of the baseline, whatever modules of them the history keeps, and requires every replaced key on the target.
Another call undoes a replaced migration by its own `down` while the history keeps its module, except the first key of `replaces`, and rejects before it changes anything when it reaches a replaced key without a module.
So `rollback` with `"all"` leaves a target without keys, and a call that leaves keys leaves at least the first key of `replaces`, a state that every history tells.

The design gives up a rollback of one migration at a time down to a target without keys: while the history keeps modules of replaced migrations and `replaces` has more than one key, calls that undo one migration each end in a rejection, at the last replaced key without a module or at the first key of `replaces`.

## A baseline that `rollback` never undoes

`rollback` and `redo` could stop at the replaced keys, so that the `down` of a baseline never runs.
It would keep a call with a large `count` from dropping the schema, as a migration that cannot be undone would for any history.
The `down` of the baseline would go unverified, and a developer could not build a database again with `rollback` and `migrate`.

## Undoing the first replaced key by its own `down`

A call could undo the first key of `replaces` by its own `down` when the history keeps its module, so that each replaced migration is undone alone.
A target that the baseline built has no key before it, so the call would leave a target without keys, which `migrate` takes as empty and builds by the baseline, on a schema that is empty only when no migration preceded the key.
A history cannot tell that: `replaces` may have lost keys from its start.
