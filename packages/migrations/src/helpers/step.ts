import type { MigrationChange, MigrationStep } from "../migration"
import { findStepProblem, runChange } from "../migration"

/**
 * Inverts a step: its `down` becomes `up`, and its `up` becomes `down`, such as to build a helper that drops what another helper creates.
 *
 * It throws for a step without `down`, which gives nothing to apply, and for a value that is not a step, such as one with a misspelled `down`, which the inverted step would hide.
 */
export function invertStep(step: MigrationStep): MigrationStep {
  const problem = findStepProblem(step)
  if (problem !== undefined) {
    throw new Error(`The step of invertStep ${problem}`)
  }
  if (step.down === undefined) {
    throw new Error("Cannot invert a step without down")
  }
  return { up: step.down, down: step.up }
}

/**
 * Combines steps into one step: its `up` runs the `up` of the steps in order, and its `down` runs the `down` of those that have one in reverse order.
 *
 * A direction whose changes are all SQL scripts is one script of them; otherwise, it is a function that runs them in order.
 * The step has no `down` when no step has one.
 * It throws for a value that is not a step, such as one with a misspelled `down`, which the combined step would hide.
 */
export function combineSteps(...steps: readonly MigrationStep[]): MigrationStep {
  if (steps.length === 0) {
    throw new Error("combineSteps requires at least one step")
  }
  const ups: MigrationChange[] = []
  const downs: MigrationChange[] = []
  for (let index = 0; index < steps.length; index++) {
    const problem = findStepProblem(steps[index])
    if (problem !== undefined) {
      throw new Error(`Step ${index + 1} of combineSteps ${problem}`)
    }
    ups.push(steps[index]!.up)
  }
  for (let index = steps.length - 1; index >= 0; index--) {
    const down = steps[index]!.down
    if (down !== undefined) {
      downs.push(down)
    }
  }
  const up = combineChanges(ups)
  return downs.length === 0 ? { up } : { up, down: combineChanges(downs) }
}

/** Combines changes into one change that runs them in order. */
function combineChanges(changes: readonly MigrationChange[]): MigrationChange {
  if (changes.length === 1) {
    return changes[0]!
  }
  if (changes.every(change => typeof change === "string")) {
    // The semicolon goes on a line of its own, so that a script that ends with a line comment does not comment it out.
    return changes.join("\n;\n")
  }
  return async database => {
    for (const change of changes) {
      await runChange(database, change)
    }
  }
}
