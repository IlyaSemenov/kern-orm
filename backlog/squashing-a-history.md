# Squashing a history

The migrations of a history are the steps between the states of a target, each from the state of the key before it to the state of its own key, and a target keeps its state.
A baseline is a migration without a key that takes an empty target to the state of a key in one go, which the migrations up to that key otherwise build one by one: the baseline replaces them.
It shortens a long history, such as for the schema of a new tenant and for `verifyMigrations`, and lets a project remove the modules of the replaced migrations.

```ts
export const migrations = defineMigrations(modules, {
  baseline: {
    migration: () => import("./baseline.ts"),
    replaces: ["0001_create_form", "0002_add_form_slug"],
  },
})
```

A call checks that the history has what takes the target from its state to the one that the call asks for, and rejects before changing anything otherwise.

## Table of versions

- The table of versions is the state of a target, the keys whose changes its schema has, rather than a log of the migrations that ran on it, and `applied_at` is the time when a key was recorded.
  The architecture and the documentation must describe it so, such as where they tell what `migrate` records and what `getMigrationStatus` gives.
- It keeps its columns and every key of the state rather than the last one: the keys tell a state of this history from a state of another one with the same last number, such as after a migration merged with a number before an applied one, or on the database of a developer who applied the migrations of another branch.
- A baseline has no row of its own: a target is in the state of the last replaced key, whichever built it.

## History

- `baseline` of the options of `defineMigrations` gives the migration, a loader of its module or the migration itself, and `replaces`, the keys of the migrations that it replaces, so that a call reads the keys without loading a module.
- `replaces` lists the last replaced keys in order without a gap, down to the last one: all of them at first, and fewer once the project removes keys from its start.
  A key of the history follows the last replaced key or is a replaced key.
- The history may keep the modules of the last replaced migrations, of all of them or of none, without a gap, such as `0098` and `0099` of 99, since calls apply and roll back migrations in order.
- A project removes keys from the start of `replaces`, and the modules of replaced migrations, once every target has applied them and no version of the application that lists them runs.
- Squashing again replaces the module of the baseline and adds the keys up to the new state to `replaces`; the previous baseline has no key to keep.
- `defineMigrations` rejects `replaces` that is empty, has a key of another form, or is out of order, a key of the history before the last replaced key that `replaces` lacks, a history that lists replaced migrations other than the last ones, and a baseline that is neither a loader nor a migration.
- The module of a baseline is not named as a key, so `new` does not take it for a migration; patterns of `import.meta.glob` must exclude it, or it lives outside the directory of the migrations.
  `new` numbers the next migration after the keys of `replaces` too.
- A baseline has no [changes outside a transaction](../architecture/migrations.md#changes-outside-a-transaction), and loading one that has them rejects: it records the replaced keys in its transaction, so that a target never has a part of them.

## Applying

- A target without rows runs the baseline, and records the keys of `replaces` in its transaction; then it applies the migrations after them.
  The baseline counts as one migration of `count`, and the call resolves to the keys that it recorded.
- A target that has the last replaced key needs nothing of the baseline: a release that squashes a history changes nothing on it, and a call that has nothing else to apply returns after the first read and loads no module.
- A target that has rows but lacks replaced keys applies their migrations when the history keeps the modules of all that it lacks.
  Otherwise `migrate` rejects it before changing anything, with an error that names the replaced keys without modules that the target lacks and tells to migrate it with a version that has them.
- Applied keys before the first key of `replaces` are not checked, since a target that the baseline built lacks them; from that key on, the rules of an applied key that the history lacks and of a pending key before an applied one hold, with the keys of `replaces` as keys of the history.
- A version of the application from before the squash finds its history applied on a target that the baseline built while `replaces` lists every key of that version, so it keeps migrating during a rolling deploy, also a target that the new version created.
- A schema that already has the tables of the baseline and no rows, such as one that [another migrator built](moving-from-rake-db.md), runs the baseline as it would run the first migration of any history: the first `CREATE TABLE` fails and the transaction rolls back, unless the baseline has `IF NOT EXISTS`.

## Rolling back

- `rollback` and `redo` undo a replaced migration whose module the history keeps by its own `down`, as any migration, except the first key of `replaces`.
- The own `down` of the first key of `replaces` never runs, also when the history keeps its module: a target that the baseline built has no row before that key, so undoing it would leave a target without rows, which a call takes as empty, on a schema that is empty only when no migration preceded the key, which a history cannot tell.
  So a call that undoes replaced migrations by their own `down` always leaves the first key of `replaces`, and the state of the target is known whatever the list.
- A call that undoes every migration of the target, by `"all"` or by a `count` of at least the number of its applied keys from the first key of `replaces` on, undoes the replaced migrations together by the `down` of the baseline rather than by their own, after it undoes the migrations after them, and removes the rows of the keys of `replaces`.
  So `rollback` with `"all"` leaves an empty target whatever modules the history keeps.
  - It requires every key of `replaces` on the target, the state that the `down` of the baseline starts from; a target that lacks some, such as after a call undid the last of them, rejects until `migrate` applies them again.
  - When the history keeps no module of a replaced migration, the replaced migrations count as one migration of `count`, the baseline.
- Another call that reaches a replaced key that it cannot undo, the first key of `replaces` or one without a module, rejects before changing anything, with an error that names the key, rather than after undoing the migrations before it.
  So calls that undo one migration each end in a rejection, while one call undoes them all.
- An applied replaced key without a module is not an applied key that the history lacks, which `rollback` and `redo` reject whatever their `count`.

## Status

- `getMigrationStatus` keeps `applied`, `pending`, and `unknown`.
  `applied` has the applied keys of `replaces`, also those without modules, which are not `unknown`; `pending` has the keys that `migrate` would record, on a target without rows the keys of `replaces` and those after them.
- `status` of the command line lists the applied keys of the target rather than the keys of the history, so that it shows the replaced keys without modules.

## Verification

- `verifyMigrations` verifies a baseline as any migration, on an empty schema: it applies it, rolls it back to the empty structure, and applies it again; then it verifies the migrations after the last replaced key.
- It skips the replaced migrations that the history keeps: they were verified before the baseline replaced them and do not change, and a history cannot tell whether the first of them starts from an empty schema.
- [Checking a baseline](writing-and-checking-a-baseline.md) runs them to compare what they and the baseline build.

## Open questions

- Decide how a `MigrationError` names the baseline, which has no key.
- Decide whether `status` and the output of `migrate` on the command line fold the keys of `replaces` into one line.

## Alternatives given up

Record them in [decisions](../decisions/README.md) with the change:

- One row with the last applied key instead of every key: a baseline then needs no `replaces`, but a migration merged with a number before the applied one is never applied, a state of another history with a later number passes as one of a newer version, and the table of every existing target changes.
- A baseline with a key and a row of its own, as a squashed migration of Django, whose applying records the migrations that it replaces and whose row follows theirs ([source](https://github.com/django/django/blob/6.0.10/django/db/migrations/executor.py#L268-L308)): its file sits among the migrations, but the row repeats what the replaced keys tell, every existing target must record it, and squashing again leaves a previous baseline to keep.
- A target that the baseline built records only the last replaced key from the start: the list is one key, but a version from before the squash rejects such a target during the rolling deploy of the squash.
- A baseline that `rollback` never undoes: it keeps a call with a large `count` from dropping the schema, as [irreversible migrations](irreversible-migrations-in-verification.md) would for any migration, but its `down` goes unverified, and a developer cannot build a database again with `rollback` and `migrate`.
- A table of records of baselines beside the table of versions, with a digest of the declared keys: it tells what built a target, which no call needs.
- `replaces` in the module of the baseline: the migration describes itself, but a call must load the module to tell replaced keys from unknown ones.
- A check that the schema is empty before the baseline runs: it tells a schema of another migrator at once, but rejects a schema that histories share, such as of a package beside the application.

## Comparison

Before the change, check and record in [comparison](../comparison/migrations.md) how other migrators replace a history and keep the state of a target, such as Django, loading the schema in Rails, `stamp` of Alembic, and baselining of Prisma.
