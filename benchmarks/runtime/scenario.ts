/**
 * Scenario of a topic: prepares its data and returns the function to measure.
 *
 * Any error of the scenario or of the function fails the run.
 */
export type Scenario = () => Measured | Promise<Measured>

/** Function that a scenario measures; the worker awaits a promise that it returns. */
export type Measured = () => unknown

/** Default export of a topic `<topic>.bench.ts`: its scenarios by name. */
export type Topic = Record<string, Scenario>
