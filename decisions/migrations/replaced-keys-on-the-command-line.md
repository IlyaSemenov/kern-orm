# Each replaced key on a line of the command line

`migrate`, `rollback`, and `redo` of the command line print a line for each key that the call resolves to, also for the keys that a baseline replaces, and `status` a line for each key of the status.
A line of the output can be searched for by its key.

The design gives up a short output for a long `replaces`, such as 99 lines after the baseline builds a new target.

## One line for the baseline

The commands could fold the keys of `replaces` into one line, such as of the first and the last key and their number.
`migrate` resolves to the keys that it recorded, which do not tell whether the baseline or the migrations of the replaced keys ran, so the fold would cover both or need another result of the call; and `status` would hide which replaced keys a target that applied a part of them lacks.
