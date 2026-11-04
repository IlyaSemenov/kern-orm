// Aggregate queries: the value of an aggregate function over the rows of a query as its only value, which lowering recognizes by the projection of the aggregate.

import type { AggregateNode, ExpressionNode, RawSqlNode, ScalarProjection } from "../ast/nodes"
import { createNode } from "../ast/nodes"
import { orderingOperators } from "../expression/operators/ordering"
import type { AnyType, TypeInput, TypeOperators } from "../type/type"
import { defineType } from "../type/type"

import { isExistsQuery } from "./exists"
import type { QueryNode, SelectedNode } from "./node"
import type { QueryValueType } from "./state"

// PostgreSQL counts in `bigint`, and a number holds every count up to `Number.MAX_SAFE_INTEGER` exactly.
/** Type of a count: a `bigint` of PostgreSQL decoded as a number, rejecting a count that a number cannot hold exactly. */
export const countType = /* @__PURE__ */ defineType({ sqlType: "bigint" })
  .transform({
    decode: text => decodeSafeInteger(text, "Count"),
    encode: (value: number) => String(value),
  })
  .withOperators(orderingOperators)

/** Type of the value of a query of a count. */
export interface CountValueType extends QueryValueType {
  readonly input: TypeInput<typeof countType>
  readonly operators: TypeOperators<typeof countType>
}

/** Types of the sums of the values of `smallint` and `integer` types, by the type of the values, created once for each. */
const sumTypes = /* @__PURE__ */ new WeakMap<AnyType, AnyType>()

const noFallbacks: readonly ExpressionNode[] = /* @__PURE__ */ Object.freeze([])

/** Aggregate methods of a query that take a column or an expression. */
export type AggregateMethod =
  | "count"
  | "countDistinct"
  | "min"
  | "max"
  | "sum"
  | "avg"
  | "every"
  | "some"
  | "stringAgg"

/** Projection of an aggregate over the rows of a query, the only projection of a query made by an aggregate method, such as `count` or `max`. */
export interface AggregateProjection extends ScalarProjection {
  /**
   * Call of the aggregate function, without an order.
   *
   * Its first argument is the value of each row, or `*` of `count(*)`; the others are parameters that do not depend on the row, such as the delimiter of `string_agg`.
   */
  readonly expression: AggregateNode
  /** Whether the aggregate takes the rows in the order of the query, as `string_agg` does; lowering adds the order to its call. */
  readonly ordered: boolean
  /** Values that replace `NULL` of the aggregate in their order, added by `coalesce`. */
  readonly fallbacks: readonly ExpressionNode[]
}

/** SQL function of an aggregate method and the type of its value. */
interface AggregateDefinition {
  readonly name: string
  readonly distinct: boolean
  readonly ordered: boolean
  /** Returns the type that decodes the value of the aggregate, by the type of its argument. */
  readonly type: (argument: AnyType) => AnyType
}

// PostgreSQL writes the values of `min`, `max`, `sum`, `bool_and`, `bool_or`, and `string_agg` as it writes the values of their argument, also where their SQL type differs, such as the `bigint` sum of `integer` values or the `text` maximum of `varchar` values, so the type of the argument decodes them.
/** Definitions of the aggregate methods that take a column or an expression. */
const aggregateDefinitions: Readonly<Record<AggregateMethod, AggregateDefinition>> =
  /* @__PURE__ */ Object.freeze({
    count: { name: "count", distinct: false, ordered: false, type: toCountType },
    countDistinct: { name: "count", distinct: true, ordered: false, type: toCountType },
    min: { name: "min", distinct: false, ordered: false, type: toArgumentType },
    max: { name: "max", distinct: false, ordered: false, type: toArgumentType },
    sum: { name: "sum", distinct: false, ordered: false, type: toSumType },
    avg: { name: "avg", distinct: false, ordered: false, type: toAverageType },
    every: { name: "bool_and", distinct: false, ordered: false, type: toArgumentType },
    some: { name: "bool_or", distinct: false, ordered: false, type: toArgumentType },
    stringAgg: { name: "string_agg", distinct: false, ordered: true, type: toArgumentType },
  })

/** Argument `*` of `count(*)`. */
const allRowsNode = /* @__PURE__ */ createNode<RawSqlNode>({
  kind: "raw",
  fragments: ["*"],
  values: [],
})

/** Projection of `count(*)`, which `count` without an argument selects; its value does not depend on the values or the order of the rows. */
export const countProjection: AggregateProjection = /* @__PURE__ */ Object.freeze({
  key: "count",
  expression: /* @__PURE__ */ createNode({
    kind: "aggregate",
    name: "count",
    distinct: false,
    arguments: [allRowsNode],
    orderBy: [],
  }),
  type: countType,
  ordered: false,
  fallbacks: noFallbacks,
})

/**
 * Creates the projection of the aggregate of `method` over the values of `argument`, the projection of a column or an expression of each row.
 *
 * `delimiter` is the delimiter of `stringAgg`, sent as a parameter.
 */
export function projectAggregate(
  method: AggregateMethod,
  argument: ScalarProjection,
  delimiter?: string,
): AggregateProjection {
  const definition = aggregateDefinitions[method]
  const args: ExpressionNode[] = [argument.expression]
  if (delimiter !== undefined) {
    args.push(createNode({ kind: "param", value: delimiter, type: undefined }))
  }
  return Object.freeze({
    key: method,
    expression: createNode({
      kind: "aggregate",
      name: definition.name,
      distinct: definition.distinct,
      arguments: args,
      orderBy: [],
    }),
    type: definition.type(argument.type),
    ordered: definition.ordered,
    fallbacks: noFallbacks,
  })
}

/** Creates the projection of the aggregate of `field` whose `NULL` `fallback` replaces after its earlier fallbacks. */
export function addFallback(
  field: AggregateProjection,
  fallback: ExpressionNode,
): AggregateProjection {
  const fallbacks = field.fallbacks.slice()
  fallbacks.push(fallback)
  return Object.freeze({
    key: field.key,
    expression: field.expression,
    type: field.type,
    ordered: field.ordered,
    fallbacks,
  })
}

/** Tells whether `node` is an aggregate query, whose value is the aggregate over the rows that its filters, limit, and offset choose. */
export function isAggregateQuery(node: QueryNode): boolean {
  return node.value && isAggregateProjection(node.projections[0]!)
}

/** Tells whether `node`, a nested query, is selected as its value rather than as packed rows: an aggregate query as a scalar subquery of its statement, and a query of `exists` as `EXISTS` of its rows. */
export function isSelectedAsValue(node: QueryNode): boolean {
  return isAggregateQuery(node) || isExistsQuery(node)
}

/** Tells whether a selected field is the projection of an aggregate, which only the aggregate methods select. */
export function isAggregateProjection(field: SelectedNode): field is AggregateProjection {
  return "ordered" in field
}

function toCountType(): AnyType {
  return countType
}

function toArgumentType(argument: AnyType): AnyType {
  return argument
}

// PostgreSQL sums `smallint` and `integer` values as a `bigint`, which their `Number` decodes without an error outside the safe integer range.
/** Returns the type of the sum of the values of type `argument`: for `smallint` and `integer` values, a `bigint` with the operators of `argument` that rejects a sum that a number cannot hold exactly, and `argument` for others. */
function toSumType(argument: AnyType): AnyType {
  if (argument.castType !== "smallint" && argument.castType !== "integer") {
    return argument
  }
  let type = sumTypes.get(argument)
  if (type === undefined) {
    // The check reads the text before `argument` decodes it, so that a type derived with `transform` keeps its values.
    type = defineType({ sqlType: "bigint" })
      .transform({
        decode: text => {
          decodeSafeInteger(text, "Sum")
          return argument.decode(text)
        },
        encode: (value: unknown) => argument.encode(value as never),
      })
      .withOperators(argument.operators)
    sumTypes.set(argument, type)
  }
  return type
}

// PostgreSQL averages `bigint` values as a `numeric`, which can have a fractional part that a type of `bigint` values cannot represent.
/** Returns the type of the average of the values of type `argument`, which decodes a fractional value where PostgreSQL gives one, such as `Number` of `integer`; rejects a type of the SQL type `bigint`. */
function toAverageType(argument: AnyType): AnyType {
  if (argument.castType === "bigint") {
    throw new TypeError(
      "avg of bigint values requires a type that can represent fractional values; average a sql fragment of the column with t.doublePrecision or t.numeric",
    )
  }
  return argument
}

/** Decodes `text` of a `bigint` as a number, rejecting one that a number cannot hold exactly; `subject` names it in the error. */
function decodeSafeInteger(text: string, subject: string): number {
  const number = Number(text)
  if (!Number.isSafeInteger(number)) {
    throw new RangeError(`${subject} ${text} is outside the safe integer range of numbers`)
  }
  return number
}
