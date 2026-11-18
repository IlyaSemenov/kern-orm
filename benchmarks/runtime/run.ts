// Runs the runtime benchmark `<topic>.bench.ts` of this directory on Bun and on Node.js against the built kern-orm, and prints the median time of each scenario.
// `--base <directory>` names another checkout of the repository with its packages built, such as a worktree of another commit; a relative directory resolves against the current directory, which is `benchmarks/` under `bun run --cwd benchmarks`.
// With it, the runner also runs the worker and the topic of that checkout against the build of that checkout, and matches the scenarios of both by name.
// It runs pairs of worker processes, one of each checkout, in alternating order, and prints the change of each scenario of both checkouts: the median of the ratios of the time of this checkout to the time of the base over the pairs, with a confidence interval of the median.
// It prints a scenario of one checkout with its median time and the checkout that has it.
// The worker of the base must take the name of a topic and print a `WorkerResult`, as the worker of this checkout does.
// `--runs <n>` sets the number of worker processes, or of pairs, per runtime.

import { spawn } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"

import { findIntervalRank, findMedian, findMedianInterval } from "../statistics.ts"

import type { WorkerResult } from "./worker.ts"

/** Probability with which the interval of a change covers its median, unless there are too few pairs for it. */
const confidence = 0.95

const runtimes = [
  // The worker of each checkout runs in its directory, so that Bun reads its config there.
  { command: process.execPath, args: ["--tsconfig-override=tsconfig.worker.json"] },
  // mitata collects garbage before each measurement through `gc` that the flag exposes.
  { command: "node", args: ["--expose-gc"] },
]

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: { base: { type: "string" }, runs: { type: "string", default: "10" } },
})
const topics: string[] = []
for (const file of readdirSync(import.meta.dirname)) {
  if (file.endsWith(".bench.ts")) {
    topics.push(file.slice(0, -".bench.ts".length))
  }
}
const [topic] = positionals
if (topic === undefined || !topics.includes(topic)) {
  console.error(`Pass the name of a topic: ${topics.toSorted().join(", ")}`)
  process.exit(1)
}
const runs = Number(options.runs)
if (!Number.isInteger(runs) || runs < 1) {
  console.error("Pass a positive number of runs")
  process.exit(1)
}

const current = import.meta.dirname
const base = options.base === undefined ? undefined : findBase(options.base)
console.log(
  base === undefined
    ? `${topic}: ${runs} processes per runtime`
    : `${topic}: this checkout against ${options.base}, ${runs} pairs of processes per runtime, intervals of ${formatPercent(findIntervalRank(runs, confidence).coverage)} confidence`,
)
for (const runtime of runtimes) {
  const currentResults: WorkerResult[] = []
  const baseResults: WorkerResult[] = []
  for (let index = 0; index < runs; index++) {
    process.stderr.write(`Run ${index + 1} of ${runs}\r`)
    if (base === undefined) {
      currentResults.push(await runWorker(runtime, current))
    } else if (index % 2 === 0) {
      baseResults.push(await runWorker(runtime, base))
      currentResults.push(await runWorker(runtime, current))
    } else {
      currentResults.push(await runWorker(runtime, current))
      baseResults.push(await runWorker(runtime, base))
    }
  }
  printResults(currentResults, base === undefined ? undefined : baseResults)
}

/** Directory of the runtime benchmarks of the checkout `directory`, after checking that it has the topic and a build of kern-orm. */
function findBase(directory: string): string {
  const checkout = resolve(directory)
  const benchmarks = join(checkout, "benchmarks/runtime")
  if (!existsSync(join(benchmarks, `${topic}.bench.ts`))) {
    console.error(`The base has no topic ${topic}: ${benchmarks}`)
    process.exit(1)
  }
  if (!existsSync(join(checkout, "packages/orm/dist"))) {
    console.error(
      `Build the packages of the base with \`bun run build\` in its directory: ${checkout}`,
    )
    process.exit(1)
  }
  return benchmarks
}

/** Runs the worker of the runtime benchmarks in `directory` with `runtime` and returns its result. */
async function runWorker(
  runtime: (typeof runtimes)[number],
  directory: string,
): Promise<WorkerResult> {
  const output = await execute(
    runtime.command,
    [...runtime.args, join(directory, "worker.ts"), topic!],
    directory,
  )
  return JSON.parse(output.trim().split("\n").at(-1)!)
}

/** Runs `command` in `cwd` and returns its standard output; when it fails, it rejects with its standard error and output. */
function execute(command: string, args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    let errors = ""
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk))
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (errors += chunk))
    child.on("error", reject)
    child.on("close", code => {
      if (code === 0) {
        resolve(output)
      } else {
        reject(
          new Error(
            `${[command, ...args].join(" ")} failed with code ${code}:\n${errors}${output}`,
          ),
        )
      }
    })
  })
}

/** Prints the median time of each scenario and, for a scenario of both checkouts, the median of the ratios of the pairs with its confidence interval. */
function printResults(currentResults: WorkerResult[], baseResults?: WorkerResult[]): void {
  console.log(currentResults[0]!.runtime)
  const names = Object.keys(currentResults[0]!.scenarios)
  const baseNames = baseResults === undefined ? [] : Object.keys(baseResults[0]!.scenarios)
  for (const name of baseNames) {
    if (!names.includes(name)) {
      names.push(name)
    }
  }
  const width = Math.max(...names.map(name => name.length))
  for (const name of names) {
    const label = name.padEnd(width)
    if (!Object.hasOwn(currentResults[0]!.scenarios, name)) {
      console.log(
        `  ${label}  only in the base: ${formatTime(findMedian(collectTimes(baseResults!, name)))}`,
      )
      continue
    }
    const currentTimes = collectTimes(currentResults, name)
    const currentTime = formatTime(findMedian(currentTimes))
    if (baseResults === undefined) {
      console.log(`  ${label}  ${currentTime}`)
    } else if (!baseNames.includes(name)) {
      console.log(`  ${label}  ${currentTime}, not in the base`)
    } else {
      const baseTimes = collectTimes(baseResults, name)
      const ratios = currentTimes.map((time, index) => time / baseTimes[index]!)
      const { low, high, coverage } = findMedianInterval(ratios, confidence)
      // An interval that includes no change does not tell the direction of the change, nor does one of too few pairs for the confidence.
      const inconclusive =
        coverage < confidence
          ? ", inconclusive: too few pairs"
          : low <= 1 && high >= 1
            ? ", inconclusive"
            : ""
      console.log(
        `  ${label}  ${formatTime(findMedian(baseTimes))} → ${currentTime}  ${formatChange(findMedian(ratios))} (${formatChange(low)} … ${formatChange(high)})${inconclusive}`,
      )
    }
  }
}

/** Times of scenario `name` in `results`. */
function collectTimes(results: WorkerResult[], name: string): number[] {
  const times: number[] = []
  for (const result of results) {
    if (!Object.hasOwn(result.scenarios, name)) {
      throw new Error(`The worker did not measure scenario "${name}"`)
    }
    times.push(result.scenarios[name]!)
  }
  return times
}

function formatTime(nanoseconds: number): string {
  if (nanoseconds < 1e3) {
    return `${nanoseconds.toPrecision(3)} ns`
  }
  if (nanoseconds < 1e6) {
    return `${(nanoseconds / 1e3).toPrecision(3)} µs`
  }
  return `${(nanoseconds / 1e6).toPrecision(3)} ms`
}

function formatChange(ratio: number): string {
  return `${ratio < 1 ? "−" : "+"}${formatPercent(Math.abs(ratio - 1))}`
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}
