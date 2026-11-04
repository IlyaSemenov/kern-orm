// Changelog generator of the releases: the default one, with one line for the updated dependencies of a package instead of a line for each of their changesets.
import changelog from "@changesets/cli/changelog"

export default {
  ...changelog,
  getDependencyReleaseLine(_changesets, dependencies) {
    if (dependencies.length === 0) return ""
    const versions = dependencies.map(({ name, newVersion }) => `${name}@${newVersion}`).join(", ")
    return `- Updated dependencies: ${versions}`
  },
}
