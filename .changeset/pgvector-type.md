---
"kern-orm": minor
---

Add the `vector` type of pgvector, whose values are arrays of numbers, with the distances `l2Distance`, `negativeInnerProduct`, `cosineDistance`, and `l1Distance`, such as `db.document.orderBy(document => document.embedding.cosineDistance(embedding))`, and `vectorOperators` for other vector types.
