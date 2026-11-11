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

/**
 * Runs a command in `cwd` without blocking the event loop and returns its standard output, throwing with its standard error on failure or after `timeout` milliseconds.
 *
 * A command that needs a server of the calling process, such as npm of the registry of the package test, must run this way.
 */
export async function runAsync(cmd: string[], cwd: string, timeout: number): Promise<string> {
  const child = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe", timeout })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    const outcome = child.signalCode === null ? "failed" : "timed out"
    throw new Error(`${cmd.join(" ")} ${outcome}:\n${stdout}${stderr}`)
  }
  return stdout
}
