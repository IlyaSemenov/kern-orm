# Conditions on columns of a related record

A short condition on a column of a related record of a relation `one`, such as on the rubric of the idea of a comment, which `where(comment => comment.idea.where({ rubricId }).exists())` or `where(comment => comment.idea.get("rubricId").eq(rubricId))` writes in full.

- Decide its form, such as an object of the relation in an object condition, `where({ idea: { rubricId } })`, which `matches`, `and`, `or`, and `not` would take too.
- Decide whether a relation `many` takes it, as a condition that some related record matches.
