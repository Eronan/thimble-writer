<script setup lang="ts">
import type { StoryChapter } from '~/types/storyWriter'

defineProps<{
  chapters: StoryChapter[]
  busy: boolean
}>()

const chapter = defineModel<StoryChapter>('chapter', { required: true })
const emit = defineEmits<{ select: [id: string]; add: [] }>()
</script>

<template>
  <section class="chapter-header">
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
      <button class="lore-add-button" type="button" :disabled="busy" @click="emit('add')">
        Add chapter
      </button>
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
  </section>
</template>
