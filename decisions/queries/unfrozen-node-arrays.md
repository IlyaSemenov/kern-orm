# Arrays of nodes not frozen

Nodes, queries, and their nested objects are frozen, but arrays of nodes, such as operands and projections, are immutable only by their `readonly` types.

- Freezing the arrays too would reject a change of an array at runtime, but in Bun 1.4.4 it costs about 180 ns for each array and makes iterating it about 30 times slower, on every query built and compiled.
