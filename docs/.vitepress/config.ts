import { defineConfig } from "vitepress"

// The site serves the docs of the last release, Stable, at its root and the docs of `main`, Next, under next/.
const origin = "https://ilyasemenov.github.io"
const stableBase = "/kern-orm/"
const nextBase = `${stableBase}next/`
const nextLabel = "Next (unreleased)"
const isNext = process.env.DOCS_TRACK === "next"

export default defineConfig({
  title: "kern-orm",
  description:
    "Fully typed relational query builder for PostgreSQL with ambient transactions and single-query relation loading",
  base: isNext ? nextBase : stableBase,
  // Search engines should send users to the docs of the version they can install.
  head: isNext ? [["meta", { name: "robots", content: "noindex" }]] : [],
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Docs", link: "/getting-started" },
      {
        text: isNext ? nextLabel : "Stable",
        // An absolute URL, since the other track is outside `base`, and a target, which makes the router load it as another site.
        items: [
          { text: "Stable", link: `${origin}${stableBase}`, target: "_self" },
          { text: nextLabel, link: `${origin}${nextBase}`, target: "_self" },
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
