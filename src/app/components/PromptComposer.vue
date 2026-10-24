<script setup lang="ts">
defineProps<{
  error: string
  status: string
  generating: boolean
  modelAvailable: boolean
  contextPreview: {
    budget: {
      inputChars: number
      storyLimitChars: number
      storyChars: number
      summaryChars: number
      loreLimitChars: number
    }
    story: string
    summaries: string
    prompt: string
    loreEntries: string
    loreError: string
    loreSelectorInputChars: number
    loreGenerationLimitChars: number
  }
}>()

const prompt = defineModel<string>({ required: true })
const emit = defineEmits<{ write: [] }>()
</script>

<template>
  <div class="composer">
    <label for="next-prompt" class="composer-label">NEXT SCENE DIRECTION</label>
    <textarea
      id="next-prompt"
      v-model="prompt"
      class="prompt-input"
      placeholder="A hint, a scene, or a twist for the next part…"
      @keydown.ctrl.enter.prevent="emit('write')"
      @keydown.meta.enter.prevent="emit('write')"
    />
    <details class="context-preview">
      <summary>What will be sent · context budget</summary>
      <p class="context-preview-note">
        Recent prose and summaries are sent with your direction. Lore entries are sent to a selector first;
        relevant entries are then limited to the available lore budget. Character counts are estimates
        based on the shared token budget.
      </p>
      <dl class="context-preview-stats">
        <div><dt>Available input budget</dt><dd>{{ contextPreview.budget.inputChars }} chars</dd></div>
        <div><dt>Recent prose</dt><dd>{{ contextPreview.budget.storyChars }} / {{ contextPreview.budget.storyLimitChars }} chars</dd></div>
        <div><dt>Story summaries</dt><dd>{{ contextPreview.budget.summaryChars }} chars</dd></div>
        <div><dt>Lore selection input</dt><dd>{{ contextPreview.loreEntries.length }} / {{ contextPreview.loreSelectorInputChars }} chars</dd></div>
        <div><dt>Selected lore for writing</dt><dd>up to {{ contextPreview.loreGenerationLimitChars }} chars</dd></div>
      </dl>
      <p v-if="contextPreview.loreError" class="context-preview-error">{{ contextPreview.loreError }}</p>
      <div v-if="contextPreview.prompt" class="context-preview-block">
        <span>Writing direction</span>
        <pre>{{ contextPreview.prompt }}</pre>
      </div>
      <div v-if="contextPreview.story" class="context-preview-block">
        <span>Recent prose sent</span>
        <pre>{{ contextPreview.story }}</pre>
      </div>
      <div v-if="contextPreview.summaries" class="context-preview-block">
        <span>Story summaries sent</span>
        <pre>{{ contextPreview.summaries }}</pre>
      </div>
      <div v-if="contextPreview.loreEntries" class="context-preview-block">
        <span>Numbered lore entries sent to selector</span>
        <pre>{{ contextPreview.loreEntries }}</pre>
      </div>
    </details>
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
