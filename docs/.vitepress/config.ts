import { defineConfig } from "vitepress"

// The site serves the docs of the last release, Release, at its root and the docs of `main`, Dev, under dev/.
// The switch names them Release and Development rather than by a version, since the packages of the site have versions of their own.
const origin = "https://ilyasemenov.github.io"
const releaseBase = "/kern-orm/"
const devBase = `${releaseBase}dev/`
const isDev = process.env.DOCS_TRACK === "dev"
const releaseLabel = "Release"
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
      { text: "ORM", link: "/orm/getting-started", activeMatch: "^/orm/" },
      { text: "Database", link: "/database/getting-started", activeMatch: "^/database/" },
      { text: "Migrations", link: "/migrations/getting-started", activeMatch: "^/migrations/" },
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
      {
        text: "ORM",
        items: [
          { text: "Getting Started", link: "/orm/getting-started" },
          { text: "Tables and Schemas", link: "/orm/schemas" },
          { text: "Types", link: "/orm/types" },
          {
            text: "Queries",
            link: "/orm/queries/",
            items: [
              { text: "Selecting", link: "/orm/queries/selecting" },
              { text: "Filtering", link: "/orm/queries/filtering" },
              { text: "Operators", link: "/orm/queries/operators" },
              { text: "Sorting and Pagination", link: "/orm/queries/sorting" },
              { text: "Grouping", link: "/orm/queries/grouping" },
              { text: "Related Records", link: "/orm/queries/relations" },
              { text: "Expressions", link: "/orm/queries/expressions" },
              { text: "Inserting, Updating, and Deleting", link: "/orm/queries/mutations" },
              { text: "Composing Queries", link: "/orm/queries/composing" },
              { text: "Reusable Queries", link: "/orm/queries/reusable" },
              { text: "SQL Statements", link: "/orm/queries/sql" },
            ],
          },
          { text: "Singleton Tables", link: "/orm/singleton-tables" },
          { text: "Multiple Schemas", link: "/orm/multiple-schemas" },
          { text: "Transactions", link: "/orm/transactions" },
          { text: "Testing", link: "/orm/testing" },
          { text: "Errors", link: "/orm/errors" },
          { text: "Custom Types", link: "/orm/custom-types" },
        ],
      },
      {
        text: "Database",
        items: [
          { text: "Getting Started", link: "/database/getting-started" },
          { text: "Drivers", link: "/database/drivers" },
          { text: "SQL Queries and Scripts", link: "/database/sql" },
          { text: "Types", link: "/database/types" },
          { text: "Transactions", link: "/database/transactions" },
          { text: "Testing", link: "/database/testing" },
          { text: "Errors", link: "/database/errors" },
          { text: "Custom Drivers", link: "/database/custom-drivers" },
          { text: "Building Query Builders", link: "/database/query-builders" },
          { text: "Building Packages", link: "/database/packages" },
        ],
      },
      {
        text: "Migrations",
        items: [
          { text: "Getting Started", link: "/migrations/getting-started" },
          { text: "Migrations", link: "/migrations/" },
          { text: "Custom Migration Helpers", link: "/migrations/custom-helpers" },
          { text: "Migrations in a Package", link: "/migrations/package-migrations" },
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
