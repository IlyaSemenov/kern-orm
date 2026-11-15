# Changesets

This folder is managed by `@changesets/cli` and stores release notes for pending version changes.
See the [Changesets documentation](https://github.com/changesets/changesets) for the workflow and file format.

## Adding a changeset

- Add one `.changeset/*.md` file for each independently releasable user-visible change.
- Do not add changesets for internal refactors, maintenance, tests, or documentation changes that do not require a package release.
- Add the changesets of a change together with it: the package test installs the packed packages with npm from a registry of its own at the versions of the release plan, so a new package at version `0.0.0`, or a range that only the next version satisfies, fails it until its changeset exists.
- Choose the SemVer bump from the public contract: `patch` for backward-compatible fixes and `minor` for backward-compatible functionality.
- Before 1.0, use `minor` for breaking changes; starting with 1.0, use `major` and remove this rule.
- Create `.changeset/<unique-name>.md` with this format, listing every affected package:

```markdown
---
"kern-orm": patch
---

Describe the user-visible change.
```

- Briefly describe the user-observable change or new capability in the public contract, without implementation details or rationale.
  Prefer a single sentence.
- Name a member of a `Db` or a `Database` as users call it, such as `db.$lock()` and `database.lock()`, rather than as a member of its type.
- For a fix, describe the problem users saw, not how the fix works:
  - Avoid: "Compare cache keys by the normalized path instead of the raw argument."
  - Prefer: "Fix stale results when the same file is passed through different relative paths."
- Do not edit package versions or `CHANGELOG.md` by hand, and do not run `changeset version` or `changeset publish`; the maintainer releases pending changesets with `npx changesets-local`.
