# Literals and SQL text in other projects

How other projects write a value and text into a statement without a parameter, as `literal` and `unsafeSql` of `kern-db` do, is not checked yet, so [comparison/expressions.md](../comparison/expressions.md) has no scenario of them and the [decision](../decisions/expressions/literal-and-unsafe-sql.md) names no project.

- Check, in the versions of [comparison/README.md](../comparison/README.md), the functions of Drizzle ORM, Kysely, Slonik, Prisma ORM, Postgres.js, Bun SQL, node-postgres, and Orchid ORM that write a literal or unchecked SQL text.
- For a literal, record the values that each takes, how it writes a number, a string with a backslash, and a `Date`, and whether its documentation calls it safe for input of a user.
- For SQL text, record its name and whether the name or the documentation marks it as unchecked.
- Record them as scenarios of comparison/expressions.md, and name in the decision the projects that chose an alternative that it weighs.
- Decide whether what they show changes a rule of `literal`, such as the values it rejects.
