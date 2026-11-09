# Package compatibility

A companion package is a published package that works with `kern-orm`, such as a driver or the migrator.
It requires `kern-orm` by a range of the whole 0.x series, such as `>=0.2.0 <1`, as a peer dependency, so that a new minor version of `kern-orm` does not release it.
A published version keeps its range forever, so a package manager accepts it with every later version of `kern-orm` before 1.0, and the peer range alone does not prevent incompatible combinations:

- A change of what a companion package relies on must keep the published versions working by default, such as by keeping the old name of a renamed method as a deprecated alias until 1.0.
- A change may break published versions only by an explicit decision, which requires:
  - releasing a version of the package that works with the change;
  - deprecating the broken versions with `npm deprecate`.
- A companion package that starts to rely on a newer version of `kern-orm` must raise the minimum of its range.

The compatibility test runs a consumer of each companion package in two projects that install packages from npm:

- the packed package with the minimum of its range;
- the oldest published version of the package that is not deprecated and whose range accepts the packed `kern-orm`, with the packed `kern-orm`, unless the package has none, such as before its first release.

The packed `kern-orm` has the version that the pending changesets release.
A minimum that npm does not have yet runs with the packed `kern-orm` only when it is the version of the workspace, between the version commit of a release and its publishing, or the version that the pending changesets release, so that a mistake in a range fails the test.
A consumer of the migrator also installs a driver: the packed one when its range accepts the `kern-orm` of the project, else the newest published one that does.

Each companion package lists what it relies on, such as [drivers](drivers.md#compatibility) and [migrations](migrations.md#compatibility).
