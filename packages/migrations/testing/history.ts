// Histories of the tests of the migrator, of migrations given as values.
import type {
  Migration,
  MigrationHistory,
  MigrationHistoryOptions,
  MigrationLoader,
} from "@kern-orm/migrations"
import { defineMigrations } from "@kern-orm/migrations"

/** Defines a history of migrations given as values, as modules that export them would. */
export function defineTestHistory(
  migrations: Record<string, Migration>,
  options?: MigrationHistoryOptions,
): MigrationHistory {
  const loaders: Record<string, MigrationLoader> = {}
  for (const [key, migration] of Object.entries(migrations)) {
    loaders[key] = async () => ({ default: migration })
  }
  return defineMigrations(loaders, options)
}
