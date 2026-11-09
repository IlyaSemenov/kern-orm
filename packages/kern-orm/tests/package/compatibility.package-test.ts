// Checks each companion package with the oldest `kern-orm` of its range, and its oldest published version that must keep working with the current `kern-orm`, installing them from npm; the `test:compat` script builds the packages first.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

import { getReleasePlan } from "@changesets/get-release-plan"

import { run } from "./run"

const root = join(import.meta.dir, "../../../..")

// The companion packages, with the companion packages that the consumer of each also installs.
const companionPackages: { dir: string; dependencies?: string[] }[] = [
  { dir: "packages/postgres-js" },
  { dir: "packages/node-postgres" },
  { dir: "packages/migrations", dependencies: ["packages/postgres-js"] },
]

/** Fields of the manifest of a package version that the test reads. */
interface Manifest {
  name: string
  version: string
  peerDependencies?: Record<string, string>
  deprecated?: string
}

/** A package version that a consumer installs: a packed workspace package or a version published to npm. */
interface Source {
  manifest: Manifest
  dir?: string
}

/** Returns the manifest of a workspace package. */
async function readManifest(dir: string): Promise<Manifest> {
  return await Bun.file(join(root, dir, "package.json")).json()
}

/** Returns the versions of a package published to npm, from the oldest, or none before its first release. */
async function fetchPublished(name: string): Promise<Manifest[]> {
  const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
  })
  if (response.status === 404) {
    return []
  }
  if (!response.ok) {
    throw new Error(`Cannot fetch ${name} from npm: ${response.status} ${response.statusText}`)
  }
  const { versions } = (await response.json()) as { versions: Record<string, Manifest> }
  return Object.values(versions).sort((a, b) => Bun.semver.order(a.version, b.version))
}

/** Tells whether the range of a companion package accepts a version of `kern-orm`. */
function acceptsKernOrm(manifest: Manifest, version: string): boolean {
  const range = manifest.peerDependencies?.["kern-orm"]
  return range !== undefined && Bun.semver.satisfies(version, range)
}

const kernOrm = await readManifest("packages/kern-orm")
const { releases } = await getReleasePlan(root)
const plannedKernOrm = releases.find(
  release => release.name === kernOrm.name && release.type !== "none",
)?.newVersion
// The workspace code of `kern-orm` is released as the version that the pending changesets give it.
const currentKernOrm: Source = {
  manifest: { ...kernOrm, version: plannedKernOrm ?? kernOrm.version },
  dir: "packages/kern-orm",
}
const publishedKernOrm = await fetchPublished(kernOrm.name)

// The workspace packages that the scenarios install, by their directory, with their published versions.
const workspace = new Map<string, { manifest: Manifest; published: Manifest[] }>()
for (const { dir, dependencies = [] } of companionPackages) {
  for (const packageDir of [dir, ...dependencies]) {
    if (!workspace.has(packageDir)) {
      const manifest = await readManifest(packageDir)
      workspace.set(packageDir, { manifest, published: await fetchPublished(manifest.name) })
    }
  }
}

/** Returns the oldest `kern-orm` in the range of a companion package. */
function resolveMinimumKernOrm(companion: Manifest): Source {
  const range = companion.peerDependencies?.["kern-orm"] ?? ""
  const minimum = /^>=(\S+) <1$/.exec(range)?.[1]
  if (minimum === undefined) {
    throw new Error(
      `${companion.name} must require kern-orm by a range of the whole 0.x series, not ${range}`,
    )
  }
  const published = publishedKernOrm.find(manifest => manifest.version === minimum)
  if (published !== undefined) {
    return { manifest: published }
  }
  // Until npm has the minimum, the workspace code stands for it only as the version that the workspace has, before its release completes, or that the pending changesets release, so that a mistake such as 0.80.0 for 0.8.0 fails.
  if (minimum === kernOrm.version || minimum === plannedKernOrm) {
    return currentKernOrm
  }
  throw new Error(
    `${companion.name} requires kern-orm ${minimum}, which is not published, and is neither the version of the workspace nor the version that the pending changesets release`,
  )
}

/** Returns the version of a companion package that a consumer installs beside another with a version of `kern-orm`: the workspace one when its range accepts that version, else the newest published one that does. */
function resolveDependency(dir: string, kernOrmVersion: string): Source {
  const { manifest, published } = workspace.get(dir)!
  if (acceptsKernOrm(manifest, kernOrmVersion)) {
    return { manifest, dir }
  }
  const accepting = published.findLast(version => acceptsKernOrm(version, kernOrmVersion))
  if (accepting === undefined) {
    throw new Error(`No version of ${manifest.name} accepts kern-orm ${kernOrmVersion}`)
  }
  return { manifest: accepting }
}

/** A consumer project of a companion package: the packages it installs, starting from the companion package and `kern-orm`. */
interface Scenario {
  name: string
  sources: Source[]
}

/** Returns the scenarios of a companion package: the current version with the oldest `kern-orm` of its range, and its oldest published version that must keep working with the current `kern-orm`, one that is not deprecated and whose range accepts it, unless it has none, such as before its first release. */
function getScenarios(dir: string, dependencies: readonly string[]): Scenario[] {
  const { manifest, published } = workspace.get(dir)!
  const minimumKernOrm = resolveMinimumKernOrm(manifest)
  const scenarios: Scenario[] = [
    {
      name: "minimum-kern-orm",
      sources: [
        { manifest, dir },
        minimumKernOrm,
        ...dependencies.map(dependency =>
          resolveDependency(dependency, minimumKernOrm.manifest.version),
        ),
      ],
    },
  ]
  const { version } = currentKernOrm.manifest
  const oldest = published.find(
    candidate => candidate.deprecated === undefined && acceptsKernOrm(candidate, version),
  )
  if (oldest !== undefined) {
    scenarios.push({
      name: "published-package",
      sources: [
        { manifest: oldest },
        currentKernOrm,
        ...dependencies.map(dependency => resolveDependency(dependency, version)),
      ],
    })
  }
  return scenarios
}

/** Names a package version of a scenario, marking a packed workspace package. */
function describeSource({ manifest, dir }: Source): string {
  return `${manifest.name}@${manifest.version}${dir === undefined ? "" : " of the workspace"}`
}

let work: string
// The packed workspace packages by their directory.
const tarballs = new Map<string, string>()

/** Packs a workspace package as npm publishes it, with the version of its manifest in the source. */
async function pack({ manifest, dir }: Source & { dir: string }): Promise<string> {
  const [{ filename }] = JSON.parse(
    run(["npm", "pack", "--json", "--pack-destination", work], join(root, dir)),
  ) as [{ filename: string }]
  const tarball = join(work, filename)
  const { version } = await readManifest(dir)
  if (version === manifest.version) {
    return tarball
  }
  // The ranges of companion packages that require the version that the pending changesets release accept the packed workspace package.
  const staging = await mkdtemp(join(work, "staging-"))
  run(["tar", "-xzf", tarball, "-C", staging], work)
  const packageJson = join(staging, "package/package.json")
  await writeFile(
    packageJson,
    JSON.stringify({
      ...JSON.parse(await readFile(packageJson, "utf8")),
      version: manifest.version,
    }),
  )
  const versioned = join(work, `${basename(dir)}-${manifest.version}.tgz`)
  run(["tar", "-czf", versioned, "-C", staging, "package"], work)
  return versioned
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "kern-orm-compatibility-"))
  for (const dir of ["packages/kern-orm", ...workspace.keys()]) {
    const source = dir === currentKernOrm.dir ? currentKernOrm : workspace.get(dir)!
    tarballs.set(dir, await pack({ manifest: source.manifest, dir }))
  }
}, 60_000)

afterAll(async () => {
  await rm(work, { recursive: true, force: true })
})

/** Creates a consumer project that installs the packages of a scenario from npm, with the peer dependencies they leave to it, and the fixture of the companion package. */
async function createProject(project: string, dir: string, sources: readonly Source[]) {
  const { devDependencies } = await Bun.file(join(root, "package.json")).json()
  const dependencies: Record<string, string> = { "@types/node": devDependencies["@types/node"] }
  for (const { manifest, dir } of sources) {
    dependencies[manifest.name] = dir === undefined ? manifest.version : `file:${tarballs.get(dir)}`
  }
  // Optional peer dependencies too, such as `@types/pg`, which the fixture needs.
  for (const { manifest } of sources) {
    for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (!(name in dependencies)) {
        dependencies[name] = range
      }
    }
  }
  await cp(join(import.meta.dir, "fixtures/companion-consumers", basename(dir)), project, {
    recursive: true,
  })
  await writeFile(
    join(project, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies }),
  )
  await writeFile(
    join(project, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "nodenext",
        target: "esnext",
        strict: true,
        noEmit: true,
        types: ["node"],
      },
      include: ["*.ts"],
    }),
  )
  run(
    ["npm", "install", "--no-audit", "--no-fund", "--no-package-lock", "--ignore-scripts"],
    project,
    120_000,
  )
}

describe.each(companionPackages)("$dir", ({ dir, dependencies = [] }) => {
  describe.each(getScenarios(dir, dependencies))("$name", ({ name, sources }) => {
    const project = () => join(work, name, basename(dir))

    beforeAll(async () => {
      await createProject(project(), dir, sources)
    }, 120_000)

    test(`installs ${sources.map(describeSource).join(", ")}`, async () => {
      const installed = await Promise.all(
        sources.map(async ({ manifest }) => {
          const { version } = await Bun.file(
            join(project(), "node_modules", manifest.name, "package.json"),
          ).json()
          return `${manifest.name}@${version}`
        }),
      )
      expect(installed).toEqual(
        sources.map(({ manifest }) => `${manifest.name}@${manifest.version}`),
      )
    })

    test("resolves the installed kern-orm from every package", () => {
      const resolve = (from: string) =>
        realpathSync(dirname(Bun.resolveSync("kern-orm/package.json", from)))
      const kernOrm = resolve(project())
      for (const { manifest } of sources) {
        expect(resolve(join(project(), "node_modules", manifest.name))).toBe(kernOrm)
      }
    })

    test("type-checks a consumer", () => {
      run([join(root, "node_modules/.bin/tsc"), "-p", project()], project())
    }, 60_000)

    describe.each(["node", "bun"])("%s", runtime => {
      test.skipIf(!process.env.DATABASE_URL)("runs statements in PostgreSQL", async () => {
        const output = run([runtime, "consumer.ts"], project())
        expect(JSON.parse(output)).toEqual(await Bun.file(join(project(), "expected.json")).json())
      })
    })
  })
})
