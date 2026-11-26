# An error of a baseline without a key

A `MigrationError` of a baseline has `undefined` as its `key`, and its message names the baseline, such as `The baseline failed in up of step 1`.
A baseline has no key, and no key of the history tells its module from that of a migration.

The design gives up a `key` that is always a string, so code that reads the `key` of any `MigrationError`, such as `assertUpError` of a migration test, handles `undefined`.

## The last replaced key as the key of the error

The error could carry the last key of `replaces`, the state that the baseline builds, with a property that marks the baseline.
`key` would stay a string, but a log that prints it would name a migration whose module the history may also keep, while the baseline failed.
