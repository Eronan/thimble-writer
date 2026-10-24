<script setup lang="ts">
import { computed, ref } from 'vue'
import type { StoryChapter } from '~/types/storyWriter'

const props = defineProps<{
  chapters: StoryChapter[]
  busy: boolean
}>()

const chapter = defineModel<StoryChapter>('chapter', { required: true })
const emit = defineEmits<{ select: [id: string]; add: [] }>()
const expanded = ref(false)
const chapterNumber = computed(() => props.chapters.findIndex(item => item.id === chapter.value.id) + 1)
</script>

<template>
  <section class="chapter-header">
    <header class="chapter-summary">
      <div>
        <span class="chapter-summary-number">CHAPTER {{ chapterNumber }}</span>
        <h2>{{ chapter.title.trim() || 'Untitled chapter' }}</h2>
      </div>
      <div class="chapter-summary-actions">
        <button class="lore-add-button" type="button" :disabled="busy" @click="emit('add')">
          New Chapter
        </button>
        <button
          class="chapter-expand-button"
          type="button"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          {{ expanded ? 'Hide details' : 'Chapter details' }}
          <span aria-hidden="true">{{ expanded ? '⌃' : '⌄' }}</span>
        </button>
      </div>
    </header>
    <div v-if="expanded" class="chapter-details">
      <div class="chapter-controls">
        <label class="chapter-select-field">
          <span>Chapter</span>
          <select
            :value="chapter.id"
            :disabled="busy"
            aria-label="Select chapter"
            @change="emit('select', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="item in chapters" :key="item.id" :value="item.id">
              {{ item.title.trim() || 'Untitled chapter' }}
            </option>
          </select>
        </label>
        <label class="chapter-title-field">
          <span>Title</span>
          <input v-model="chapter.title" :disabled="busy" aria-label="Chapter title" placeholder="Chapter title">
        </label>
      </div>
      <label class="chapter-synopsis-field">
        <span>Chapter synopsis <small>Used as context while writing this chapter</small></span>
        <textarea
          v-model="chapter.synopsis"
          :disabled="busy"
          aria-label="Chapter synopsis"
          placeholder="What needs to happen in this chapter?"
          rows="3"
        />
      </label>
    </div>
  </section>
</template>
