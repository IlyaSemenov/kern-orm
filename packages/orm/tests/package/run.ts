/**
 * Runs a command in `cwd` and returns its standard output, throwing with its standard error on failure.
 *
 * `timeout` limits a command that can hang, in milliseconds: `spawnSync` blocks the event loop, so the timeout of the calling test cannot stop it.
 */
export function run(cmd: string[], cwd: string, timeout?: number): string {
  const result = Bun.spawnSync({ cmd, cwd, timeout })
  if (result.exitCode !== 0) {
    const outcome = result.exitedDueToTimeout ? "timed out" : "failed"
    throw new Error(`${cmd.join(" ")} ${outcome}:\n${result.stdout}${result.stderr}`)
  }
  return result.stdout.toString()
}
