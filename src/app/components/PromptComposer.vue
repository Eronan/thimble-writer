<script setup lang="ts">
defineProps<{
  error: string
  status: string
  generating: boolean
  modelAvailable: boolean
}>()

const prompt = defineModel<string>({ required: true })
const emit = defineEmits<{ write: [] }>()
</script>

<template>
  <div class="composer">
    <label for="next-prompt" class="composer-label">WHAT HAPPENS NEXT?</label>
    <textarea
      id="next-prompt"
      v-model="prompt"
      class="prompt-input"
      placeholder="A hint, a scene, or a twist for the next part…"
      @keydown.ctrl.enter.prevent="emit('write')"
      @keydown.meta.enter.prevent="emit('write')"
    />
    <div class="composer-footer">
      <span class="shortcut">⌘ / Ctrl + Enter to write</span>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <p v-else class="status-message" aria-live="polite">{{ status }}</p>
      <button class="write-button" type="button" :disabled="!generating && !modelAvailable" @click="emit('write')">
        <span aria-hidden="true">{{ generating ? '■' : '✦' }}</span>
        {{ generating ? 'Stop writing' : 'Write next' }}
        <span v-if="!generating" class="button-arrow" aria-hidden="true">↗</span>
      </button>
    </div>
  </div>
</template>
