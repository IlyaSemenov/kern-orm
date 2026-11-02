// File names of a directory of migrations: the migration modules and the files of their migration tests.

/** Extensions of migration modules and files of migration tests; other files of a directory, such as `*.json`, are neither. */
export const moduleExtensions = new Set([".ts", ".mts", ".js", ".mjs"])

const migrationTestSuffix = ".migration-test"

/**
 * Returns the key of the migration of a file of migration tests named `<key>.migration-test.<extension>` or `<key>.<name>.migration-test.<extension>`, such as `0003_add_form_slug` of `0003_add_form_slug.migration-test.ts`, or `undefined` for a file name of another form.
 *
 * The key is the file name up to its first dot, which may be of another form than the key of a migration.
 */
export function getMigrationTestKey(fileName: string): string | undefined {
  const extensionDot = fileName.lastIndexOf(".")
  if (extensionDot < 0 || !moduleExtensions.has(fileName.slice(extensionDot))) {
    return undefined
  }
  const stem = fileName.slice(0, extensionDot)
  if (!stem.endsWith(migrationTestSuffix)) {
    return undefined
  }
  const key = stem.slice(0, stem.indexOf("."))
  return key === "" ? undefined : key
}
