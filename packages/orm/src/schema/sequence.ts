// Sequences of schemas: the descriptor of a sequence, and its reference in a schema or a `Db`, which names it in the PostgreSQL schema of the statement and calls its functions.

import type { ExpressionNode, NameNode } from "../ast/nodes"
import { createList, createNode } from "../ast/nodes"
import type { AnyDb } from "../execution/db"
import type { Expression } from "../expression/expression"
import { toExpression, toFunctionOperandNode } from "../expression/expression"
import type { Operand, OperandValue } from "../expression/operators/comparison"
import { bigint } from "../type/builtins/numeric"
import type { TypeInput, TypeOperators, TypeOutput } from "../type/type"

import type { SchemaObject } from "./schema"

/**
 * Descriptor of a PostgreSQL sequence by its name, which a schema includes beside its tables.
 *
 * Like a table, it has no PostgreSQL schema: a `Db` names it in its own.
 */
export interface Sequence<Name extends string = string> {
  readonly kind: "sequence"
  readonly name: Name
}

/** Sequence of any name. */
export type AnySequence = Sequence

/** Sequences by their keys; a key must not start with `$`, which is reserved for schema and `Db` members. */
export type Sequences = Record<string, AnySequence>

/** Expression of a value `T` of a sequence, such as of `nextval`, of the type `bigint` of kern-orm, which decodes it to a `bigint`. */
export type SequenceValue<T extends TypeOutput<typeof bigint> | null = TypeOutput<typeof bigint>> =
  Expression<T, TypeOperators<typeof bigint>, TypeInput<typeof bigint>>

/** Defines a sequence of a schema by its name in PostgreSQL, such as `defineSequence("form_number_seq")`. */
export function defineSequence<Name extends string>(name: Name): Sequence<Name> {
  if (typeof name !== "string" || name === "") {
    throw new TypeError("defineSequence() takes the name of a sequence as a non-empty string")
  }
  return Object.freeze({ kind: "sequence", name })
}

/** Tells whether an object of a schema is a sequence rather than a table or a view. */
export function isSequence(object: SchemaObject): object is AnySequence {
  return object.kind === "sequence"
}

/**
 * Sequence of a schema or a `Db`, such as `db.formNumberSeq`, which a statement names in the PostgreSQL schema of the `Db` that runs it.
 *
 * Interpolated into SQL, such as of `$query`, it becomes the name of the sequence, as in `ALTER SEQUENCE ${db.formNumberSeq} RESTART`.
 * Its methods return expressions of the functions of the sequence, for SQL and for queries alike.
 * A sequence of a `Db` runs only in statements of that `Db`, and a sequence of a schema in a statement of any `Db` whose schema includes it.
 */
export class SequenceReference<S extends AnySequence = AnySequence> {
  constructor(
    readonly sequence: S,
    /** `Db` that the sequence is bound to, or `undefined` for a sequence of a schema. */
    readonly db: AnyDb | undefined,
  ) {
    Object.freeze(this)
  }

  /** Returns the expression of `nextval` of the sequence, which advances the sequence and gives its new value when its statement runs. */
  nextval(): SequenceValue {
    return this.#call("nextval", [])
  }

  /**
   * Returns the expression of `currval` of the sequence, which gives the value of the sequence in the session when its statement runs: the value that `nextval` last gave or `setval` last set without `isCalled` of `false`.
   *
   * PostgreSQL rejects the statement before either in the session.
   */
  currval(): SequenceValue {
    return this.#call("currval", [])
  }

  /**
   * Returns the expression of `setval` of the sequence, which sets the last value of the sequence to `value` and gives `value` when its statement runs.
   *
   * The next `nextval` then gives the value after `value`, or `value` itself when `isCalled` is `false`.
   * An expression of `value` that is `NULL` leaves the sequence unchanged and gives `NULL`.
   */
  setval<V extends Operand<bigint, bigint | number>>(
    value: V,
    isCalled?: boolean,
  ): SequenceValue<bigint | Extract<OperandValue<V>, null>> {
    const operands = [toFunctionOperandNode(value, bigint, "setval")]
    if (isCalled !== undefined) {
      if (typeof isCalled !== "boolean") {
        throw new TypeError("setval() takes isCalled as a Boolean")
      }
      operands.push(createNode({ kind: "boolean", value: isCalled }))
    }
    return this.#call("setval", operands)
  }

  /** Creates the expression of the call of the function `name` of the sequence, which takes the sequence before `operands`. */
  #call(name: string, operands: ExpressionNode[]): SequenceValue<never> {
    const sequence = createNode<NameNode>({
      kind: "name",
      object: this.sequence,
      db: this.db,
      regclass: true,
    })
    operands.unshift(sequence)
    return toExpression(createList(`${name}(`, operands, ")"), bigint) as SequenceValue<never>
  }
}
