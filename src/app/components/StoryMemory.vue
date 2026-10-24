<script setup lang="ts">
import { locateSection, type StorySectionSummary } from '~/utils/storySections'

defineProps<{
  story: string
  busy: boolean
  modelAvailable: boolean
  activeSummaryId: string | null
}>()

const summaries = defineModel<StorySectionSummary[]>({ required: true })
const emit = defineEmits<{
  summarize: []
  remove: [id: string]
  hover: [id: string | null]
}>()

function sourcePreview(source: string) {
  const text = source.replace(/\s+/g, ' ').trim()
  return text.length > 110 ? `${text.slice(0, 110)}…` : text
}
</script>

<template>
  <section class="memory-panel">
    <div class="memory-heading">
      <div>
        <p class="eyebrow">LONG-TERM CONTEXT</p>
        <h1>Story memory</h1>
      </div>
      <span class="count-pill">{{ summaries.length }} sections</span>
    </div>
    <p class="section-description">
      Older paragraphs are summarized here and sent with the recent draft when you write.
      The story itself remains unchanged.
    </p>
    <button
      class="summarize-button"
      type="button"
      :disabled="busy || !modelAvailable || !story.trim()"
      @click="emit('summarize')"
    >
      {{ busy ? 'Summarizing…' : 'Summarize older sections' }}
    </button>
    <div v-if="summaries.length" class="memory-list">
      <article
        v-for="(section, index) in summaries"
        :key="section.id"
        class="memory-card"
        :class="{ 'memory-card-active': activeSummaryId === section.id }"
        @mouseenter="emit('hover', section.id)"
        @mouseleave="emit('hover', null)"
        @focusin="emit('hover', section.id)"
        @focusout="emit('hover', null)"
      >
        <header>
          <span class="memory-number">SECTION {{ index + 1 }}</span>
          <span v-if="!locateSection(story, section)" class="memory-stale">Source unavailable</span>
          <span v-else-if="locateSection(story, section)?.stale" class="memory-stale">Story edited</span>
          <button
            class="memory-remove"
            type="button"
            :aria-label="`Remove summary ${index + 1}`"
            @click="emit('remove', section.id)"
          >×</button>
        </header>
        <textarea
          v-model="section.summary"
          :aria-label="`Summary of section ${index + 1}`"
          rows="3"
        />
        <details class="memory-source">
          <summary>Original story excerpt</summary>
          <p>{{ sourcePreview(section.source) }}</p>
        </details>
      </article>
    </div>
    <div v-else class="memory-empty">
      <span aria-hidden="true">✦</span>
      <p>Summaries will appear as your story grows. The newest paragraphs stay in full so the next continuation has the immediate context.</p>
    </div>
  </section>
</template>
