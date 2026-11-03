// Measures the scenarios of a topic against one build of kern-orm and prints their times as JSON; `run.ts` starts it on Bun and on Node.js.
// Arguments: the path of the topic, and the directory of the build, such as `packages/kern-orm/dist`.
// Every function is called once as a check, warmed up untimed, and measured by mitata, which collects garbage before it.
// The times of a scenario differ more between processes than within one, so a worker measures each briefly, and `run.ts` runs several workers.

import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { do_not_optimize, measure } from "mitata"

import type { Build, Measured, Topic } from "./scenario.ts"
import { Unsupported } from "./scenario.ts"

/** Time of the untimed calls before a measurement, in milliseconds, which give the JIT time to optimize the code that the measurement times. */
const warmUpTime = 200

/** Minimum time of the calls that a measurement times, in milliseconds. */
const measurementTime = 250

/** Times of the scenarios that a worker prints: the average time of a call in nanoseconds, or what the build lacks. */
export interface WorkerResult {
  runtime: string
  scenarios: Record<string, { time: number } | { unsupported: string }>
}

const [topicPath, buildPath] = process.argv.slice(2)
if (topicPath === undefined || buildPath === undefined) {
  throw new Error("Pass the path of a topic and the directory of a build of kern-orm")
}
const build: Build = {
  orm: await import(pathToFileURL(join(buildPath, "index.mjs")).href),
  types: await import(pathToFileURL(join(buildPath, "types.mjs")).href),
}
const topic: Topic = (await import(pathToFileURL(topicPath).href)).default

const result: WorkerResult = {
  runtime:
    process.versions.bun === undefined
      ? `Node.js ${process.versions.node}`
      : `Bun ${process.versions.bun}`,
  scenarios: {},
}
for (const [name, scenario] of Object.entries(topic(build))) {
  try {
    const measured = await scenario()
    if (measured instanceof Unsupported) {
      result.scenarios[name] = { unsupported: measured.reason }
      continue
    }
    result.scenarios[name] = { time: await measureScenario(measured) }
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
