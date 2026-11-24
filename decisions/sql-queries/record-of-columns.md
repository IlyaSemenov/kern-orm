# `RecordOf` of the columns of a record

`RecordOf` of `kern-db` names the record that the [columns of a record](../../architecture/sql-queries.md#columns-of-records) read from one row, as `select` of a query of SQL text decodes it for their field, `null` included for the columns of `nullable`.
`kern-orm` re-exports it, so that one type serves the columns of `columnsOf` and of `createSqlColumns`.

```ts
const claimed = columnsOf(db.job, ["id", "task"], { alias: "j" })

type ClaimedJob = RecordOf<typeof claimed>
// { id: number; task: string }
```

The alternatives:

- `ResultOf` that takes columns would give users of kern-orm one name for the record of a query, of a helper, and of columns, as it does for the first two ([decision](../queries/result-of-a-helper.md)).
  But users of `createSqlColumns` without kern-orm need it too, so `kern-db` would declare a second `ResultOf`, of queries of SQL text and of columns.
  In every form of the conditional type of kern-orm with the branch of helpers that was tried, with either order of its branches, TypeScript 6 and 7 rejected passing a record of generic columns from the `ResultOf` of kern-orm to the one of `kern-db`, as below.
  The opposite direction compiled.

  ```ts
  import type { AnySqlColumns, ResultOf as DbResultOf } from "kern-orm/db"
  import type { ResultOf } from "kern-orm"

  function passOn<C extends AnySqlColumns>(record: ResultOf<C>): DbResultOf<C> {
    return record // TS2322: ResultOf<C> is not assignable to DbResultOf<C>
  }
  ```

- `FieldOutput`, the value of any field of `select`, a type or columns, would name the field of generic code over fields.
  But `TypeOutput` names the values of a type, and generic code over fields has `DecodedFields`.
- `ColumnsOf` would read as the columns themselves, rather than their record, and differ from `columnsOf` of kern-orm only by case.
