// API for authors of query builders on top of kern-db: compiling SQL fragments into statements of a builder, queries of SQL text of the statements that a builder compiles, the columns of the records of a builder, such as of its tables, in SQL text, and the rules by which kern-db encodes parameters, quotes names, and decodes results.
export { cutIdentifier, maxCharacterBytes, maxIdentifierBytes, quoteIdentifier } from "./identifier"
export type { ResultMode } from "./result"
export {
  createFieldDecodeError,
  createResultDecodeError,
  isRecordKey,
  takeOnlyRow,
  toMissingResult,
  toValueRows,
} from "./result"
export type {
  AnySqlColumns,
  HasColumnsKey,
  NullableColumnsArguments,
  NullableColumnsOptions,
  PresenceKey,
  RecordOf,
  SqlColumn,
  SqlColumns,
  SqlColumnsField,
  SqlColumnsOptions,
  SqlColumnsRecord,
} from "./sql/columns"
export { createSqlColumns } from "./sql/columns"
export type { GuaranteedColumnKeys, IsIndexKey, PickSelectedColumns } from "./selected-columns"
// The types that the columns of a builder name, so that a module that imports only this entry point emits its declarations.
export type { AnyType, TypeOutput } from "./type/type"
export { decodeNull } from "./type/type"
export { rejectThenable } from "./utils/synchronous"
export type { ParameterBinder } from "./sql/fragment"
export { renderFragment, SqlFragment } from "./sql/fragment"
export { assertUntypedValue, bindParameter, encodeParameter } from "./sql/parameter"
export type { StatementSource } from "./sql/query"
export { SqlQuery, startSqlQuery } from "./sql/query"
