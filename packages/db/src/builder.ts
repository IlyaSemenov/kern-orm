// API for authors of query builders on top of kern-db: compiling SQL fragments into statements of a builder, queries of SQL text of the statements that a builder compiles, and the rules by which kern-db encodes parameters, quotes names, and decodes results.
export { quoteIdentifier } from "./identifier"
export type { ResultMode } from "./result"
export {
  createFieldDecodeError,
  createResultDecodeError,
  isRecordKey,
  takeOnlyRow,
  toMissingResult,
  toValueRows,
} from "./result"
export type { ParameterBinder } from "./sql/fragment"
export { renderFragment, SqlFragment } from "./sql/fragment"
export { assertUntypedValue, bindParameter, encodeParameter } from "./sql/parameter"
export type { StatementSource } from "./sql/query"
export { SqlQuery, startSqlQuery } from "./sql/query"
