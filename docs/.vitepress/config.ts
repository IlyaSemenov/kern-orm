import { defineConfig } from "vitepress"

import kernOrmPackage from "../../packages/kern-orm/package.json"

// The site serves the docs of the last release, Release, at its root and the docs of `main`, Dev, under dev/.
const origin = "https://ilyasemenov.github.io"
const releaseBase = "/kern-orm/"
const devBase = `${releaseBase}dev/`
const isDev = process.env.DOCS_TRACK === "dev"
// The version of kern-orm in the commit of Release: Release builds at that commit, and the workflow passes it to the build of Dev, since `main` can hold a version that is not released yet.
const releaseLabel = `v${process.env.DOCS_RELEASE_VERSION ?? kernOrmPackage.version}`
const devLabel = "Development"

export default defineConfig({
  title: "kern-orm",
  description:
    "Fully typed relational query builder for PostgreSQL with ambient transactions and single-query relation loading",
  base: isDev ? devBase : releaseBase,
  // Search engines should send users to the docs of the version they can install.
  head: isDev ? [["meta", { name: "robots", content: "noindex" }]] : [],
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Docs", link: "/getting-started" },
      {
        text: isDev ? devLabel : releaseLabel,
        // An absolute URL, since the other track is outside `base`, and a target, which makes the router load it as another site.
        items: [
          { text: releaseLabel, link: `${origin}${releaseBase}`, target: "_self" },
          { text: devLabel, link: `${origin}${devBase}`, target: "_self" },
        ],
      },
    ],
    sidebar: [
      { text: "Getting Started", link: "/getting-started" },
      { text: "Drivers", link: "/drivers" },
      { text: "Tables and Schemas", link: "/schemas" },
      { text: "Types", link: "/types" },
      {
        text: "Queries",
        link: "/queries/",
        items: [
          { text: "Selecting", link: "/queries/selecting" },
          { text: "Filtering", link: "/queries/filtering" },
          { text: "Operators", link: "/queries/operators" },
          { text: "Sorting and Pagination", link: "/queries/sorting" },
          { text: "Grouping", link: "/queries/grouping" },
          { text: "Related Records", link: "/queries/relations" },
          { text: "Expressions", link: "/queries/expressions" },
          { text: "Inserting, Updating, and Deleting", link: "/queries/mutations" },
          { text: "Composing Queries", link: "/queries/composing" },
          { text: "Reusable Queries", link: "/queries/reusable" },
          { text: "SQL Statements", link: "/queries/sql" },
        ],
      },
      { text: "Multiple Schemas", link: "/multiple-schemas" },
      { text: "Transactions", link: "/transactions" },
      { text: "Migrations", link: "/migrations" },
      { text: "Testing", link: "/testing" },
      {
        text: "Extending",
        items: [
          { text: "Custom Types", link: "/custom-types" },
          { text: "Custom Migration Helpers", link: "/migration-helpers" },
          { text: "Custom Drivers", link: "/custom-drivers" },
        ],
      },
    ],
    search: { provider: "local" },
    editLink: {
      pattern: "https://github.com/IlyaSemenov/kern-orm/edit/main/docs/:path",
    },
    socialLinks: [{ icon: "github", link: "https://github.com/IlyaSemenov/kern-orm" }],
  },
})
