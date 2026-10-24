<script setup lang="ts">
defineProps<{
  canUndo: boolean
  generating: boolean
}>()

const story = defineModel<string>({ required: true })
const emit = defineEmits<{ undo: [] }>()
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
  <textarea
    v-model="story"
    class="story-input"
    aria-label="Story"
    :readonly="generating"
    placeholder="Your story starts here. Write a first line yourself, or ask Ollama to begin."
  />
</template>
