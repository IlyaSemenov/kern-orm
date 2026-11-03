// Runs the runtime benchmark `<topic>.bench.ts` of this directory on Bun and on Node.js against the built kern-orm, and prints the median time of each scenario.
// With `--base <ref>`, it also builds kern-orm of the commit in a temporary worktree and prints the change of each scenario from it: the median of its ratios over pairs of worker processes, one of each build, run in alternating order, with a confidence interval of the median.
// `--runs <n>` sets the number of worker processes, or of pairs, per runtime.

import type { ChildProcess } from "node:child_process"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { findIntervalRank, findMedian, findMedianInterval } from "../statistics.ts"

import type { WorkerResult } from "./worker.ts"

const root = join(import.meta.dirname, "../..")

/** Probability with which the interval of a change covers its median, unless there are too few pairs for it. */
const confidence = 0.95

const runtimes = [
  { command: process.execPath, args: [] },
  // mitata collects garbage before each measurement through `gc` that the flag exposes.
  { command: "node", args: ["--expose-gc"] },
]

/** Process that runs now, which an interruption stops before it removes the worktree. */
let running: ChildProcess | undefined
/** Temporary worktree of the base commit, removed when the run ends. */
let worktree: string | undefined

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  process.on(signal, async () => {
    const child = running
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill()
      await once(child, "close")
    }
    removeWorktree()
    process.exit(code)
  })
}

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

try {
  const current = join(root, "packages/kern-orm/dist")
  const base = options.base === undefined ? undefined : await buildBase(options.base)
  console.log(
    base === undefined
      ? `${topic}: ${runs} processes per runtime`
      : `${topic}: the current build against ${base.commit}, ${runs} pairs of processes per runtime, intervals of ${formatPercent(findIntervalRank(runs, confidence).coverage)} confidence`,
  )
  for (const runtime of runtimes) {
    const currentResults: WorkerResult[] = []
    const baseResults: WorkerResult[] = []
    for (let index = 0; index < runs; index++) {
      process.stderr.write(`Run ${index + 1} of ${runs}\r`)
      if (base === undefined) {
        currentResults.push(await runWorker(runtime, current))
      } else if (index % 2 === 0) {
        baseResults.push(await runWorker(runtime, base.build))
        currentResults.push(await runWorker(runtime, current))
      } else {
        currentResults.push(await runWorker(runtime, current))
        baseResults.push(await runWorker(runtime, base.build))
      }
    }
    printResults(currentResults, base === undefined ? undefined : baseResults)
  }
} finally {
  removeWorktree()
}

/** Builds kern-orm of commit `ref` in a temporary worktree and returns the directory of the build and the abbreviated commit. */
async function buildBase(ref: string): Promise<{ build: string; commit: string }> {
  const commit = (
    await execute("git", ["rev-parse", "--verify", "--short", `${ref}^{commit}`], root)
  ).trim()
  worktree = mkdtempSync(join(tmpdir(), "kern-orm-base-"))
  await execute("git", ["worktree", "add", "--detach", worktree, commit], root)
  // Lifecycle scripts, such as `prepare` that installs Git hooks, do not run for a build.
  await execute(process.execPath, ["install", "--frozen-lockfile", "--ignore-scripts"], worktree)
  await execute(process.execPath, ["run", "build"], join(worktree, "packages/kern-orm"))
  return { build: join(worktree, "packages/kern-orm/dist"), commit }
}

function removeWorktree(): void {
  if (worktree !== undefined) {
    spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd: root })
    rmSync(worktree, { recursive: true, force: true })
    worktree = undefined
  }
}

/** Runs a worker of the topic against `build` with `runtime` and returns its result. */
async function runWorker(runtime: (typeof runtimes)[number], build: string): Promise<WorkerResult> {
  const output = await execute(
    runtime.command,
    [
      ...runtime.args,
      join(import.meta.dirname, "worker.ts"),
      join(import.meta.dirname, `${topic}.bench.ts`),
      build,
    ],
    import.meta.dirname,
  )
  return JSON.parse(output.trim().split("\n").at(-1)!)
}

/** Runs `command` in `cwd` and returns its standard output; when it fails, it rejects with its standard error and output. */
function execute(command: string, args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    running = child
    let output = ""
    let errors = ""
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk))
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (errors += chunk))
    child.on("error", reject)
    child.on("close", code => {
      running = undefined
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

/** Prints the median time of each scenario of the current build and, with the results of the base build, the median of the ratios of the pairs with its confidence interval. */
function printResults(currentResults: WorkerResult[], baseResults?: WorkerResult[]): void {
  console.log(currentResults[0]!.runtime)
  const names = Object.keys(currentResults[0]!.scenarios)
  const width = Math.max(...names.map(name => name.length))
  for (const name of names) {
    const currentTimes = collectTimes(currentResults, name)
    if (typeof currentTimes === "string") {
      console.log(`  ${name.padEnd(width)}  unsupported: ${currentTimes}`)
      continue
    }
    const currentTime = formatTime(findMedian(currentTimes))
    const baseTimes = baseResults === undefined ? undefined : collectTimes(baseResults, name)
    if (baseTimes === undefined) {
      console.log(`  ${name.padEnd(width)}  ${currentTime}`)
    } else if (typeof baseTimes === "string") {
      console.log(`  ${name.padEnd(width)}  ${currentTime}, unsupported by the base: ${baseTimes}`)
    } else {
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
        `  ${name.padEnd(width)}  ${formatTime(findMedian(baseTimes))} → ${currentTime}  ${formatChange(findMedian(ratios))} (${formatChange(low)} … ${formatChange(high)})${inconclusive}`,
      )
    }
  }
}

/** Times of scenario `name` in `results`, or the reason why the build does not support it. */
function collectTimes(results: WorkerResult[], name: string): number[] | string {
  const times: number[] = []
  for (const result of results) {
    const scenario = result.scenarios[name]
    if (scenario === undefined) {
      throw new Error(`The worker did not measure scenario "${name}"`)
    }
    if ("unsupported" in scenario) {
      return scenario.unsupported
    }
    times.push(scenario.time)
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
