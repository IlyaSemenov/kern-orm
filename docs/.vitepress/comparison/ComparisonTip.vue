<script setup lang="ts">
// A trigger of a comparison matrix with a popover that opens on hover, on focus, and on a tap.
// The popover has a fixed position, so that the scroll container of the table does not clip it, and stays after the trigger in the DOM, so that Tab reaches its links.
import { computed, inject, nextTick, onBeforeUnmount, ref, type Ref, watch } from "vue"

const props = defineProps<{ id: string; label: string }>()

/** The id of the open popover of the matrix, so that one popover is open at a time. */
const active = inject<Ref<string | null>>("comparison-tip", ref(null))
const open = computed(() => active.value === props.id)
/** Whether a click keeps the popover open when the pointer leaves. */
const pinned = ref(false)
/** The fixed position of the popover, the height its panel may take, and the side of the trigger that it opens on. */
const position = ref<{
  top: number
  left: number
  maxHeight: number
  side: "below" | "above"
} | null>(null)
const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const popover = ref<HTMLElement>()
const panel = ref<HTMLElement>()
let hideTimer: ReturnType<typeof setTimeout> | undefined
/** The distance of the panel from the trigger, which the popover pads, so that the pointer crosses it within the popover. */
const gap = 6

function show() {
  clearTimeout(hideTimer)
  active.value = props.id
}

function hide() {
  clearTimeout(hideTimer)
  pinned.value = false
  if (open.value) active.value = null
}

/** Hides the popover after a delay, unless a click pinned it or the keyboard has focused it. */
function scheduleHide() {
  if (pinned.value || root.value?.querySelector(":focus-visible")) return
  clearTimeout(hideTimer)
  hideTimer = setTimeout(hide, 150)
}

function onPointerEnter(event: PointerEvent) {
  // A tap also enters, and its click then pins the popover.
  if (event.pointerType === "mouse" && !isKeyboardInAnotherTip()) show()
}

/** Tells whether the keyboard has focused another tip whose popover is open, which hover must not close. */
function isKeyboardInAnotherTip(): boolean {
  const focused = document.activeElement
  const tip = focused?.matches(":focus-visible") ? focused.closest(".tip") : null
  return !!tip?.querySelector(".popover") && !root.value?.contains(focused)
}

function onPointerLeave(event: PointerEvent) {
  if (event.pointerType === "mouse") scheduleHide()
}

function onClick() {
  if (open.value && pinned.value) {
    hide()
  } else {
    show()
    pinned.value = true
  }
}

function onFocusOut(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node | null)) hide()
}

/** Closes the popover on Escape, also one that hover opened while the focus is elsewhere. */
function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return
  // Focusing the trigger opens the popover, so it moves the focus out of the popover before hiding it.
  if (root.value?.contains(document.activeElement)) trigger.value?.focus()
  hide()
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) hide()
}

/**
 * Places the popover below the trigger, or above it when only that side fits it, within the viewport.
 * When neither side fits it, it takes the side with more room and scrolls within its height.
 */
function place() {
  if (!trigger.value || !popover.value || !panel.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const width = popover.value.offsetWidth
  // The height of the whole panel, also while a previous placement limits it.
  const height = panel.value.scrollHeight + panel.value.offsetHeight - panel.value.clientHeight
  const margin = 8
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2 - width / 2, margin),
    window.innerWidth - width - margin,
  )
  const roomBelow = window.innerHeight - anchor.bottom - gap - margin
  const roomAbove = anchor.top - gap - margin
  const side = height <= roomBelow || roomBelow >= roomAbove ? "below" : "above"
  const maxHeight = side === "below" ? roomBelow : roomAbove
  const top = side === "below" ? anchor.bottom : anchor.top - gap - Math.min(height, maxHeight)
  position.value = { top, left, maxHeight, side }
}

function listen() {
  document.addEventListener("pointerdown", onDocumentPointerDown)
  document.addEventListener("keydown", onDocumentKeydown)
  // A scroll of the page or of the table moves the trigger, and the fixed popover follows it.
  window.addEventListener("scroll", place, { capture: true, passive: true })
  window.addEventListener("resize", place)
}

function unlisten() {
  document.removeEventListener("pointerdown", onDocumentPointerDown)
  document.removeEventListener("keydown", onDocumentKeydown)
  window.removeEventListener("scroll", place, { capture: true })
  window.removeEventListener("resize", place)
}

watch(open, async isOpen => {
  position.value = null
  if (!isOpen) {
    unlisten()
    pinned.value = false
    return
  }
  listen()
  await nextTick()
  place()
})

onBeforeUnmount(() => {
  clearTimeout(hideTimer)
  unlisten()
})
</script>

<template>
  <span
    ref="root"
    class="tip"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @focusin="show"
    @focusout="onFocusOut"
  >
    <button
      ref="trigger"
      type="button"
      class="trigger"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="open ? `${id}-tip` : undefined"
      @click="onClick"
    >
      <slot name="trigger" />
    </button>
    <span
      v-if="open"
      :id="`${id}-tip`"
      ref="popover"
      class="popover"
      :style="
        position
          ? {
              top: `${position.top}px`,
              left: `${position.left}px`,
              [position.side === 'below' ? 'paddingTop' : 'paddingBottom']: `${gap}px`,
            }
          : { visibility: 'hidden' }
      "
    >
      <span ref="panel" class="panel" :style="position && { maxHeight: `${position.maxHeight}px` }">
        <slot />
      </span>
    </span>
  </span>
</template>

<style scoped>
.tip {
  display: inline-flex;
}

.trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px;
  border-radius: 4px;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.trigger:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 1px;
}

.popover {
  position: fixed;
  z-index: 50;
  display: block;
  width: max-content;
  max-width: min(320px, calc(100vw - 16px));
}

.panel {
  display: block;
  padding: 10px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-elv);
  box-shadow: var(--vp-shadow-3);
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.5;
  text-align: left;
  white-space: normal;
  overflow-y: auto;
}
</style>
