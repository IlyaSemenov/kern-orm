// Queries of `exists`: whether a query has a row as its only value, which lowering recognizes by the projection of `exists`.

import type { ScalarProjection } from "../ast/nodes"
import { trueNode } from "../ast/nodes"
import type { EqualityOperators } from "../expression/operators/equality"
import { getBooleanType } from "../type/boolean"

import type { QueryNode, SelectedNode } from "./node"
import type { QueryValueType } from "./state"

/** Type of the value of a query of `exists`. */
export interface ExistsValueType extends QueryValueType {
  readonly input: boolean
  readonly operators: EqualityOperators
}

// Created on first use: the Boolean type depends on the modules of expressions, which are not initialized while this module loads.
let existsProjection: ScalarProjection | undefined

// Lowering replaces the statement of a query of `exists` with `EXISTS` of its rows, without an order, so its expression only completes the projection, such as of a sort key of the value of the query.
/** Returns the projection of whether a query has a row, the only projection of a query made by `exists`. */
export function getExistsProjection(): ScalarProjection {
  existsProjection ??= Object.freeze({
    key: "exists",
    expression: trueNode,
    type: getBooleanType(),
  })
  return existsProjection
}

/** Tells whether `node` is a query of `exists`, whose value is whether the rows that its filters, limit, and offset choose exist. */
export function isExistsQuery(node: QueryNode): boolean {
  return node.value && isExistsProjection(node.projections[0]!)
}

/** Tells whether a selected field is the projection of `exists`, which only `exists` selects. */
export function isExistsProjection(field: SelectedNode): boolean {
  return field === existsProjection
}
