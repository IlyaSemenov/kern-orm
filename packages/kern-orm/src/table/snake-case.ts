// A word starts at a capital letter after a lowercase letter or a digit, as in `formId`, and at the last capital letter of a run before a lowercase letter, as in `JSONData`.
// The last capital letter and an `s` that end a key are a plural of the run, as in `userIDs`; before another word, such an `s` may end a word of its own, as in `URLIsValid`.
const wordStart = /(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}(?!s$)\p{Ll})/gu

/**
 * Converts a column key to snake case, such as `form_id` for `formId`, for the `columnName` option of `createTableFactory`.
 *
 * A run of capital letters is one word, such as `user_id` for `userID`, and digits stay in their word, such as `line2`.
 */
export function toSnakeCase(key: string): string {
  return key.replace(wordStart, "_").toLowerCase()
}
