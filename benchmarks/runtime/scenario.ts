// Contract of a runtime benchmark: a topic defines its scenarios over the modules of a build of kern-orm, which the worker passes to it.
// A topic imports only types from `kern-orm`, so that it also runs against the build of another commit.

import type * as Orm from "kern-orm"
import type * as Types from "kern-orm/types"

/** Modules of the build of kern-orm that a worker measures. */
export interface Build {
  orm: typeof Orm
  types: typeof Types
}

/** Result of a scenario that the build lacks an API for, such as one that a later commit adds. */
export class Unsupported {
  /** What the build lacks. */
  readonly reason: string

  constructor(reason: string) {
    this.reason = reason
  }
}

/** Marks a scenario as one that the build lacks an API for; the worker skips it for the build. */
export function unsupported(reason: string): Unsupported {
  return new Unsupported(reason)
}

/**
 * Scenario of a topic: prepares its data and returns the function to measure, or `unsupported` after a check of the API of the build.
 *
 * Any error of the scenario or of the function fails the run.
 */
export type Scenario = () => Measured | Unsupported | Promise<Measured | Unsupported>

/** Function that a scenario measures; the worker awaits a promise that it returns. */
export type Measured = () => unknown

/** Default export of a topic `<topic>.bench.ts`: its scenarios by name, over a build. */
export type Topic = (build: Build) => Record<string, Scenario>
