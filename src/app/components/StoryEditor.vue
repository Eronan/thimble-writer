<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { locateSection, type StorySectionSummary } from '~/utils/storySections'

const props = defineProps<{
  canUndo: boolean
  generating: boolean
  summaries: StorySectionSummary[]
  activeSummaryId: string | null
}>()

const story = defineModel<string>({ required: true })
const emit = defineEmits<{ undo: [] }>()
const input = ref<HTMLTextAreaElement | null>(null)
const highlightLayer = ref<HTMLDivElement | null>(null)

const segments = computed(() => {
  const text = story.value
  const activeSection = props.summaries.find(section => section.id === props.activeSummaryId)
  const range = activeSection ? locateSection(text, activeSection) : null
  if (!range) return [{ text, active: false }]
  return [
    { text: text.slice(0, range.start), active: false },
    { text: text.slice(range.start, range.end), active: true },
    { text: text.slice(range.end), active: false },
  ].filter(segment => segment.text.length > 0)
})

function syncScroll() {
  if (!input.value || !highlightLayer.value) return
  highlightLayer.value.scrollTop = input.value.scrollTop
  highlightLayer.value.scrollLeft = input.value.scrollLeft
}

watch(() => props.activeSummaryId, async (id) => {
  if (!id) return
  await nextTick()
  const layer = highlightLayer.value
  const mark = layer?.querySelector('mark.active')
  if (!layer || !mark || !input.value) return
  const markTop = mark.getBoundingClientRect().top - layer.getBoundingClientRect().top + layer.scrollTop
  input.value.scrollTop = Math.max(0, markTop - layer.clientHeight / 2)
  syncScroll()
})
</script>

<template>
  <div class="story-heading">
    <div>
      <p class="eyebrow">THE DRAFT</p>
      <h1>Your story</h1>
    </div>
    <div class="story-actions">
      <span class="word-count">{{ story.trim() ? story.trim().split(/\s+/).length : 0 }} words</span>
      <button class="undo-button" type="button" :disabled="!canUndo || generating" @click="emit('undo')">Undo</button>
    </div>
  </div>
  <div class="story-editor">
    <div ref="highlightLayer" class="story-highlight-layer" aria-hidden="true">
      <template v-for="(segment, index) in segments" :key="index">
        <mark v-if="segment.active" class="active">{{ segment.text }}</mark>
        <span v-else>{{ segment.text }}</span>
      </template>
    </div>
    <textarea
      ref="input"
      v-model="story"
      class="story-input"
      aria-label="Story"
      :readonly="generating"
      placeholder="Your story starts here. Write a first line yourself, or ask Ollama to begin."
      @scroll="syncScroll"
    />
  </div>
</template>
