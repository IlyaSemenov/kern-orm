// Measures the scenarios of a topic against the build of kern-orm of its checkout and prints their times as JSON; `run.ts` starts it on Bun and on Node.js.
// Argument: the name of the topic.
// Every function is called once as a check, warmed up untimed, and measured by mitata, which collects garbage before it.
// The times of a scenario differ more between processes than within one, so a worker measures each briefly, and `run.ts` runs several workers.

import { do_not_optimize, measure } from "mitata"

import type { Measured, Topic } from "./scenario.ts"

/** Time of the untimed calls before a measurement, in milliseconds, which give the JIT time to optimize the code that the measurement times. */
const warmUpTime = 200

/** Minimum time of the calls that a measurement times, in milliseconds. */
const measurementTime = 250

/** Times of the scenarios that a worker prints: the average time of a call in nanoseconds. */
export interface WorkerResult {
  runtime: string
  scenarios: Record<string, number>
}

const [topicName] = process.argv.slice(2)
if (topicName === undefined) {
  throw new Error("Pass the name of a topic")
}
const topic: Topic = (await import(`./${topicName}.bench.ts`)).default

const result: WorkerResult = {
  runtime:
    process.versions.bun === undefined
      ? `Node.js ${process.versions.node}`
      : `Bun ${process.versions.bun}`,
  scenarios: {},
}
for (const [name, scenario] of Object.entries(topic)) {
  try {
    result.scenarios[name] = await measureScenario(await scenario())
  } catch (error) {
    throw new Error(`Scenario "${name}" failed`, { cause: error })
  }
}
console.log(JSON.stringify(result))

/** Average time of a call of `measured` in nanoseconds. */
async function measureScenario(measured: Measured): Promise<number> {
  // The first call checks that the function works before it is timed.
  const first = measured()
  if (first instanceof Promise) {
    await first
  }
  const call =
    first instanceof Promise
      ? async () => do_not_optimize(await measured())
      : () => do_not_optimize(measured())
  const end = performance.now() + warmUpTime
  while (performance.now() < end) {
    await call()
  }
  return (await measure(call, { min_cpu_time: measurementTime * 1e6 })).avg
}
