# Relations of conditions in types

Research whether types should check the relations that the queries of a condition read, such as `survey.questions` in `where(survey => survey.questions.exists())`, and decide whether to check them at all: lowering rejects a relation that the `Db` lacks at runtime ([architecture/queries.md](../architecture/queries.md#queries-of-a-db)), and the cost in types may outweigh the cases it catches.
A condition carries no relations in types, unlike a selection, which carries them in `uses`, so types accept:

- a helper of a schema whose callback filters by a relation, such as `defineHelper(schema.survey, query => query.where(survey => survey.questions.exists()))`, on a query without the relation, such as `from(survey)`, where the callback fails to read the relation, while types reject a helper that selects the relation there ([architecture/queries.md](../architecture/queries.md#helpers));
- a query of a `Db` whose condition reads a relation that the relations of the `Db` lack, which only lowering rejects;
- a selected expression of a query of a relation, such as `form.fields.count().expr()`, in both of these ways, unlike the same query selected as it is;
- a key of `groupBy` and a condition of `having` that read a relation, such as `groupBy(form => form.fields.count())`, in the same ways, since `groupBy` and `having` keep `uses`.

Checking them needs the relations in the types of expressions and conditions, so measure its cost with `bench:types` before choosing a design.
