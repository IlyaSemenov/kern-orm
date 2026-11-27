<script setup lang="ts">
// The icon of a status of a comparison matrix.
import type { Status } from "./matrix"

defineProps<{ status: Status }>()

/** An SVG path in the 24 × 24 box of the icon, stroked, and filled when `fill` is set. */
interface Shape {
  d: string
  fill?: boolean
}

const circle = "M19.5 12a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0z"

/** The paths of the icon of each status, so that types require an icon of a new status. */
const shapes: Record<Status, readonly Shape[]> = {
  supported: [{ d: "M5 12.5l4.5 4.5L19 7.5" }],
  limited: [{ d: circle }, { d: "M12 4.5a7.5 7.5 0 0 0 0 15z", fill: true }],
  external: [{ d: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" }],
  preview: [
    {
      d: "M9 3.5h6M10 3.5v6l-5.2 8.6A1.6 1.6 0 0 0 6.2 20.5h11.6a1.6 1.6 0 0 0 1.4-2.4L14 9.5v-6M7.5 14.5h9",
    },
  ],
  unsupported: [{ d: "M6.5 6.5l11 11M17.5 6.5l-11 11" }],
  declined: [{ d: circle }, { d: "M6.7 17.3L17.3 6.7" }],
  unknown: [{ d: "M8.8 9a3.2 3.2 0 1 1 4.5 2.9c-.8.4-1.3 1.1-1.3 2v.6M12 18.5v.01" }],
}
</script>

<template>
  <svg
    class="icon"
    :class="status"
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      v-for="(shape, index) in shapes[status]"
      :key="index"
      :d="shape.d"
      :fill="shape.fill ? 'currentColor' : undefined"
    />
  </svg>
</template>

<style scoped>
.icon {
  display: block;
}

.supported {
  color: var(--vp-c-green-1);
}

.unsupported,
.declined {
  color: var(--vp-c-red-1);
}

.limited,
.preview {
  color: var(--vp-c-yellow-1);
}

.external {
  color: var(--vp-c-indigo-1);
}

.unknown {
  color: var(--vp-c-text-3);
}
</style>
