# Package compatibility

A companion package is a published package that works with `kern-orm`, such as a driver or the migrator.
It requires `kern-orm` by a range of the whole 0.x series, such as `>=0.2.0 <1`, as a peer dependency, so that a new minor version of `kern-orm` does not release it.
A published version keeps its range forever, so a package manager accepts it with every later version of `kern-orm` before 1.0, and the peer range alone does not prevent incompatible combinations:

- A change of what a companion package relies on must keep the published versions working by default, such as by keeping the old name of a renamed method as a deprecated alias until 1.0.
  The package test runs the oldest published version of each driver that must keep working with the current `kern-orm`.
- A change may break published versions only by an explicit decision, which requires:
  - releasing a version of the package that works with the change;
  - deprecating the broken versions with `npm deprecate`;
  - moving the published version that the package test runs to the first one that works with the change.
- A companion package that starts to rely on a newer version of `kern-orm` must raise the minimum of its range.
  The package test runs each companion package with that version.

Each companion package lists what it relies on, such as [drivers](drivers.md#compatibility) and [migrations](migrations.md#compatibility).
