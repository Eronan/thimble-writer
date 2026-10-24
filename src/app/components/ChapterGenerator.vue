<script setup lang="ts">
import type { StoryChapter } from '~/types/storyWriter'

defineProps<{
  busy: boolean
  generatingChapterId: string | null
  generatingAll: boolean
  chapterCount: number
  modelAvailable: boolean
  error: string
  status: string
}>()

const chapters = defineModel<StoryChapter[]>('chapters', { required: true })
const prompt = defineModel<string>('prompt', { required: true })
const emit = defineEmits<{
  generate: [chapterId: string]
  generateAll: []
  add: []
  remove: [chapterId: string]
}>()
</script>

<template>
  <section class="chapter-generator">
    <header class="lore-workspace-heading">
      <p class="eyebrow">STORY PLANNING</p>
      <div class="structure-heading-row">
        <div>
          <h1>Story Structure</h1>
          <p class="section-description">Build the story chapter by chapter. Generated structures use established Lore and the other chapter synopses for continuity.</p>
        </div>
        <div class="structure-heading-actions">
          <button class="lore-add-button" type="button" :disabled="busy" @click="emit('add')">Add chapter</button>
          <button
            class="lore-add-button structure-generate-all"
            type="button"
            :disabled="busy || !modelAvailable"
            @click="emit('generateAll')"
          >{{ generatingAll ? 'Generating story structure…' : 'Generate full story structure' }}</button>
        </div>
      </div>
    </header>

    <div v-if="error || status" class="structure-feedback">
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <p v-else class="status-message" role="status" aria-live="polite">
        <span v-if="busy" class="structure-status-indicator" aria-hidden="true" />
        {{ status }}
      </p>
    </div>

    <label class="structure-prompt-field">
      <span>Story structure direction</span>
      <textarea
        v-model="prompt"
        :disabled="busy"
        placeholder="Add direction for the full story structure…"
        rows="3"
      />
      <small>Applied to single-chapter and full-story structure generation.</small>
    </label>

    <div class="story-structure-list">
      <article v-for="(chapter, index) in chapters" :key="chapter.id" class="story-structure-row">
        <div class="structure-chapter-title">
          <label class="chapter-title-field">
            <span>Chapter {{ index + 1 }}</span>
            <input v-model="chapter.title" :disabled="busy" :aria-label="`Chapter ${index + 1} title`">
          </label>
          <button
            class="lore-remove-button structure-remove-button"
            type="button"
            :disabled="busy || chapterCount <= 1"
            :aria-label="`Remove chapter ${index + 1}`"
            @click="emit('remove', chapter.id)"
          >Remove</button>
        </div>
        <div class="structure-synopsis">
          <label class="chapter-synopsis-field">
            <span>Story structure</span>
            <textarea
              v-model="chapter.synopsis"
              :disabled="busy"
              :aria-label="`Chapter ${index + 1} story structure`"
              placeholder="Outline the key events and turning points for this chapter…"
              rows="5"
            />
          </label>
          <button
            class="lore-add-button structure-generate-button"
            type="button"
            :disabled="busy || !modelAvailable"
            @click="emit('generate', chapter.id)"
          >
            {{ generatingChapterId === chapter.id ? 'Generating…' : 'Generate structure' }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
