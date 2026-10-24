<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { locateSection, type StorySectionSummary } from '~/utils/storySections'
import { locateFeedback, type StoryFeedback } from '~/utils/storyFeedback'

const props = defineProps<{
  canUndo: boolean
  generating: boolean
  summaries: StorySectionSummary[]
  activeSummaryId: string | null
  activeFeedbackId: string | null
  feedback: StoryFeedback[]
}>()

const story = defineModel<string>({ required: true })
const emit = defineEmits<{
  undo: []
  comment: []
  selection: [selection: { start: number; end: number; text: string } | null]
}>()
const input = ref<HTMLTextAreaElement | null>(null)
const highlightLayer = ref<HTMLDivElement | null>(null)
const selectedLength = ref(0)

const segments = computed(() => {
  const text = story.value
  const activeSection = props.summaries.find(section => section.id === props.activeSummaryId)
  const range = activeSection ? locateSection(text, activeSection) : null
  const activeFeedback = props.feedback.find(comment => comment.id === props.activeFeedbackId)
  const feedbackRange = activeFeedback ? locateFeedback(text, activeFeedback) : null
  const highlights = [
    ...(range ? [{ ...range, kind: 'summary' as const }] : []),
    ...(feedbackRange ? [{ ...feedbackRange, kind: 'feedback' as const }] : []),
  ].sort((left, right) => left.start - right.start)
  const segments: Array<{ text: string; active: boolean }> = []
  let cursor = 0
  for (const highlight of highlights) {
    if (highlight.start < cursor) continue
    if (highlight.start > cursor) segments.push({ text: text.slice(cursor, highlight.start), active: false })
    segments.push({ text: text.slice(highlight.start, highlight.end), active: true })
    cursor = highlight.end
  }
  if (cursor < text.length || !segments.length) segments.push({ text: text.slice(cursor), active: false })
  return segments.filter(segment => segment.text.length > 0)
})

function syncScroll() {
  if (!input.value || !highlightLayer.value) return
  highlightLayer.value.scrollTop = input.value.scrollTop
  highlightLayer.value.scrollLeft = input.value.scrollLeft
}

function updateSelection() {
  if (!input.value) return
  const start = input.value.selectionStart
  const end = input.value.selectionEnd
  selectedLength.value = Math.max(0, end - start)
  if (end <= start) {
    emit('selection', null)
    return
  }
  emit('selection', { start, end, text: story.value.slice(start, end) })
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

watch(() => props.activeFeedbackId, async (id) => {
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
      <button
        class="undo-button comment-selection-button"
        type="button"
        :disabled="generating"
        :title="selectedLength ? `Add a comment for ${selectedLength} selected characters` : 'Select story text, then add a comment'"
        @click="emit('comment')"
      >Add comment</button>
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
      @input="updateSelection"
      @select="updateSelection"
      @keyup="updateSelection"
      @mouseup="updateSelection"
    />
  </div>
</template>
