# `joinSql` as a function of its own

`joinSql` joins fragments and values into one fragment, by `, ` or by a separator fragment, such as the rows of a multi-row `VALUES` known only at runtime, and rejects an empty array when it is called.
`kern-db` and `kern-orm` each have it, as they have `sql` and `identifier`: that of `kern-orm` takes what its `sql` interpolates, such as expressions.

```ts
await database.query`INSERT INTO form (id, name) VALUES ${joinSql(
  forms.map(form => sql`(${form.id}, ${form.name})`),
)}`
```

The alternatives:

- A member of `sql`, `sql.join`, would be found by completion after `sql.`, where users of Drizzle ORM, Slonik, and Kysely look for it ([comparison](../../comparison/expressions.md#lists-of-sql-fragments)).
  But `identifier` is a function of its own ([decision](identifier-function.md)), so `sql` would be the only function of fragments with a member.
- The name `join`, as of sql-template-tag and `Prisma.join`, would be shorter.
  But it reads as a join of tables, which queries of the ORM will have, or as `Array.prototype.join`.
- An empty array joined into empty SQL, as Drizzle ORM and Kysely give, would serve without a check the few places where PostgreSQL takes an empty list, such as the arguments of `jsonb_build_object()`.
  But in most places of a list, such as `VALUES` and `IN`, PostgreSQL rejects the statement with a syntax error that points at neither the array nor the call.
- Rejecting an empty array when the statement compiles, as Slonik does, would also reject it.
  But the error would leave the call, and a fragment that is never compiled would hold the mistake.
