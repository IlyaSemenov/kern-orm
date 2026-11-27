<script setup lang="ts">
import { withBase } from "vitepress"
// The comparison matrix of a page: features in rows, projects in columns, the first of which is the Kern library of the page.
import { computed, provide, ref } from "vue"

import ComparisonIcon from "./ComparisonIcon.vue"
import ComparisonTip from "./ComparisonTip.vue"
import { type Matrix, type Status, toCellDetails } from "./matrix"

const props = defineProps<{ matrix: Matrix }>()

/** The groups with the cells of each feature in the order of the columns, each with its project. */
const groups = computed(() =>
  props.matrix.groups.map(group => ({
    ...group,
    features: group.features.map(feature => ({
      ...feature,
      cells: props.matrix.projects.map(project => ({
        ...toCellDetails(feature.cells[project.id] ?? "unknown"),
        project,
      })),
    })),
  })),
)

provide("comparison-tip", ref<string | null>(null))

const statusLabels: Record<Status, string> = {
  supported: "Supported",
  limited: "Limited or manual",
  external: "Separate library",
  preview: "Preview feature",
  unsupported: "Not supported",
  declined: "Declined by maintainers",
  unknown: "Not reviewed yet",
}

const statuses = Object.keys(statusLabels) as Status[]

/** Renders a text of the data as HTML: escapes it and renders its code in backticks as `<code>`. */
function toHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return escaped.replace(/`([^`]+)`/g, "<code>$1</code>")
}

/** Resolves a link to a page of the site, which starts with `/`, under the base of the site. */
function toHref(href: string): string {
  return href.startsWith("/") ? withBase(href) : href
}
</script>

<template>
  <div class="comparison-matrix">
    <div class="scroller">
      <table>
        <thead>
          <tr>
            <th class="feature" scope="col">Feature</th>
            <th
              v-for="(project, index) in matrix.projects"
              :key="project.id"
              class="project"
              :class="{ own: index === 0 }"
              scope="col"
            >
              <a v-if="project.url" :href="project.url" target="_blank" rel="noreferrer">{{
                project.name
              }}</a>
              <template v-else>{{ project.name }}</template>
              <span class="version">{{ project.version }}</span>
            </th>
          </tr>
        </thead>
        <tbody v-for="group in groups" :key="group.id">
          <tr class="group">
            <th :id="group.id" :colspan="matrix.projects.length + 1" scope="rowgroup">
              <span class="group-title"
                ><a class="anchor" :href="`#${group.id}`" :aria-label="`Link to ${group.title}`"
                  >#</a
                >{{ group.title }}</span
              >
            </th>
          </tr>
          <tr v-for="feature in group.features" :id="feature.id" :key="feature.id" class="row">
            <th class="feature" scope="row">
              <ComparisonTip :id="feature.id" :label="feature.title">
                <template #trigger><span class="title" v-html="toHtml(feature.title)" /></template>
                <span v-html="toHtml(feature.description)" />
                <span class="links">
                  <a :href="`#${feature.id}`">Link to this row</a>
                  <a
                    v-if="feature.research"
                    :href="feature.research"
                    target="_blank"
                    rel="noreferrer"
                    >Research</a
                  >
                </span>
              </ComparisonTip>
            </th>
            <td
              v-for="(cell, index) in feature.cells"
              :key="cell.project.id"
              class="cell"
              :class="{ own: index === 0 }"
            >
              <ComparisonTip
                :id="`${feature.id}-${cell.project.id}`"
                :label="`${cell.project.name}: ${statusLabels[cell.status]}`"
              >
                <template #trigger><ComparisonIcon :status="cell.status" /></template>
                <strong class="status"
                  >{{ cell.project.name }}: {{ statusLabels[cell.status] }}</strong
                >
                <span v-if="cell.note" v-html="toHtml(cell.note)" />
                <span v-if="cell.version" class="checked">Checked in {{ cell.version }}.</span>
                <span v-if="cell.href || cell.plan" class="links">
                  <a
                    v-if="cell.href"
                    :href="toHref(cell.href)"
                    v-bind="
                      cell.href.startsWith('/') ? {} : { target: '_blank', rel: 'noreferrer' }
                    "
                    >{{ cell.href.startsWith("/") ? "Documentation" : "Source" }}</a
                  >
                  <a v-if="cell.plan" :href="cell.plan" target="_blank" rel="noreferrer"
                    >Backlog item</a
                  >
                </span>
              </ComparisonTip>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <ul class="legend">
      <li v-for="status in statuses" :key="status">
        <ComparisonIcon :status="status" />
        {{ statusLabels[status] }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.comparison-matrix {
  margin: 16px 0;
}

.comparison-matrix table {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: separate;
  border-spacing: 0;
}

.comparison-matrix table tr {
  background: none;
  border: none;
}

.comparison-matrix table th,
.comparison-matrix table td {
  border: none;
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 6px 8px;
  font-size: 14px;
  font-weight: 400;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
}

.comparison-matrix thead th {
  vertical-align: bottom;
  font-weight: 600;
}

.comparison-matrix .project {
  min-width: 72px;
  text-align: center;
  line-height: 1.3;
}

.comparison-matrix .project a {
  color: inherit;
  text-decoration: none;
}

.comparison-matrix .project a:hover {
  color: var(--vp-c-brand-1);
}

.version {
  display: block;
  font-size: 12px;
  font-weight: 400;
  color: var(--vp-c-text-2);
}

/* The soft colors are translucent, so they lie over the background, which sticky cells need. */
.comparison-matrix table .own {
  background: linear-gradient(var(--vp-c-brand-soft), var(--vp-c-brand-soft)), var(--vp-c-bg);
}

.comparison-matrix .group th {
  padding-top: 20px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.comparison-matrix .row .feature {
  line-height: 1.4;
}

.title {
  text-decoration: underline dotted var(--vp-c-text-3);
  text-underline-offset: 3px;
}

.cell {
  text-align: center;
}

.cell :deep(.tip) {
  vertical-align: middle;
}

.group-title {
  display: inline-block;
}

.anchor {
  float: left;
  margin-left: -1em;
  width: 1em;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  opacity: 0;
}

.group th:hover .anchor,
.anchor:focus {
  opacity: 1;
}

.comparison-matrix table .row:target > * {
  background: linear-gradient(var(--vp-c-default-soft), var(--vp-c-default-soft)), var(--vp-c-bg);
}

.status {
  display: block;
  font-weight: 600;
}

.checked {
  display: block;
  color: var(--vp-c-text-2);
}

.links {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.links a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.legend li {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
}

/* Below the width of the fixed nav, the table scrolls sideways with its feature column in place. */
@media (max-width: 959px) {
  .scroller {
    overflow-x: auto;
  }

  .comparison-matrix table {
    min-width: 560px;
  }

  .comparison-matrix .feature,
  .group-title {
    position: sticky;
    left: 0;
    z-index: 1;
  }

  .comparison-matrix .feature {
    min-width: 150px;
  }

  /* A sticky cell is a stacking context, so the cell of an open popover lies over the cells below it. */
  .comparison-matrix .feature:has(.popover) {
    z-index: 3;
  }
}

/* With the fixed nav, the header row stays below it while the page scrolls. */
@media (min-width: 960px) {
  .comparison-matrix thead th {
    position: sticky;
    top: calc(var(--vp-nav-height) + var(--vp-layout-top-height, 0px));
    z-index: 2;
  }
}
</style>
