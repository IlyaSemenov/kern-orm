# Recognizing an operand by one lookup

`toValueNode` recognizes an expression or a query by one lookup of the symbol key `operandNode`, which it writes out rather than calling `isOperandSource`:

```ts
function toValueNode(value: unknown, type?: AnyType): ExpressionNode {
  if (typeof value === "object" && value !== null && operandNode in value) {
    return (value as OperandSource)[operandNode]()
  }
  return createNode({ kind: "param", value, type })
}
```

The alternatives replace its check:

```ts
// An expression by its class, then a query by the symbol
if (value instanceof ExpressionObject) {
  return value[expressionNode]
}
if (typeof value === "object" && value !== null && operandNode in value) {
  return (value as OperandSource)[operandNode]()
}

// A call of the same check
if (isOperandSource(value)) {
  return value[operandNode]()
}

// Only an expression by its class, as without queries in expressions
if (value instanceof ExpressionObject) {
  return value[expressionNode]
}
```

Most values are neither, and the two alternatives that keep queries in expressions took longer to build a query of them on Bun 1.4.4 and Node.js 24.18 ([benchmark](../../benchmarks/runtime/building.bench.ts)):

- recognizing an expression by its class and then a query by the symbol, 4 to 8% longer for `in` of 1000 dates, and up to 3% for `in` of 1000 strings and an insert of 1000 records on Node.js;
- calling `isOperandSource`, 6 to 8% longer for the dates and 2 to 3% for the others on Bun.

Recognizing only an expression by its class, which drops queries in expressions, is at most 2% faster, for the dates on Bun.
