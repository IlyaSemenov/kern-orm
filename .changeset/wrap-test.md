---
"kern-db": minor
"kern-orm": minor
---

Add `wrapTest` to run `node:test` and `bun:test` tests in test transactions, which roll back as soon as a test times out; under `bun:test`, pass `onTestFinished` to `createTestHelpers` for that.
