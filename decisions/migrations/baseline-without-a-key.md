# A baseline without a key or a row

A baseline of a history is a migration without a key: the options of `defineMigrations` give it with `replaces`, the keys of the migrations that it replaces, and a target that it builds records those keys and no row of the baseline.
A target is then in the state of the last replaced key, whichever built it: a release that squashes a history changes nothing on a target that has the key, and a version of the application from before the squash finds its history applied on a target that the baseline built.

The design gives up a baseline that describes itself in its module, a table of versions that tells what built a target, and a list of one key.

## A baseline with a key and a row of its own

A baseline could be a migration of the history with a key, as a squashed migration of Django, whose applying records the migrations that it replaces and then itself, and which every `migrate` records on a target that has applied all of them.
Its file would sit among the migrations, where `new` and the patterns of `import.meta.glob` find it.
The row would repeat what the replaced keys tell, every existing target would have to record it, and squashing again would leave a previous baseline to keep or to replace in turn.

## Only the last replaced key on a target that the baseline built

A target that the baseline built could record the last replaced key alone, so that `replaces` is one key from the start.
A version of the application from before the squash would find its earlier migrations pending before an applied one, and would reject such a target during the rolling deploy of the squash.
A project shortens `replaces` to that key itself, once no such version runs.

## A table of records of baselines

A table beside the table of versions could record each baseline that ran, with a digest of the keys that it declared.
It would tell what built a target, which no call needs: a call needs the state of the target, which the keys give.

## `replaces` in the module of the baseline

The module of the baseline could export `replaces` beside its steps, so that the migration describes itself.
A call would have to load the module to tell replaced keys from unknown ones, also on a target that is up to date, which loads no module.

## A check that the schema is empty

`migrate` could check that the target schema is empty before it runs the baseline, as Prisma ORM rejects a schema that is not empty and has no table of migrations.
It would tell a schema that another migrator built at once, rather than by the first `CREATE TABLE` that fails.
It would reject a schema that histories share, such as of a package beside the application, whose tables are there before the baseline of the other history runs.
