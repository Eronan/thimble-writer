<script setup lang="ts">
import type { Draft } from '~/types/storyWriter'
import type { OllamaModel } from '~/clients/ollamaClient'

defineProps<{
  models: OllamaModel[]
  loadingModels: boolean
  selectedModelSize?: number
}>()

const draft = defineModel<Draft>('draft', { required: true })
const settingsOpen = defineModel<boolean>('settingsOpen', { required: true })
defineEmits<{ refresh: [] }>()
</script>

<template>
  <header class="topbar">
    <a class="brand" href="/" aria-label="Thimble Writer home">
      <span class="brand-mark" aria-hidden="true">T</span>
      <span>Thimble <span class="brand-light">Writer</span></span>
    </a>

    <div class="toolbar">
      <span class="connection" :class="{ online: models.length > 0 }">
        <span class="connection-dot" />
        {{ models.length > 0 ? 'Ollama connected' : 'Ollama offline' }}
      </span>
      <select v-model="draft.model" aria-label="Ollama model" :disabled="loadingModels || !models.length">
        <option value="" disabled>{{ loadingModels ? 'Loading models…' : 'Select a model' }}</option>
        <option v-for="model in models" :key="model.name" :value="model.name">{{ model.name }}</option>
      </select>
      <button class="icon-button refresh-button" type="button" aria-label="Refresh models" title="Refresh models" :disabled="loadingModels" @click="$emit('refresh')">
        <span :class="{ spinning: loadingModels }">↻</span>
      </button>
      <button class="settings-toggle" type="button" :aria-expanded="settingsOpen" @click="settingsOpen = !settingsOpen">
        <span aria-hidden="true">⚙</span> Settings
        <span class="chevron" :class="{ open: settingsOpen }">⌄</span>
      </button>
    </div>

    <section v-if="settingsOpen" class="settings-panel" aria-label="Writing settings">
      <div class="settings-heading">
        <div>
          <p class="eyebrow">TUNE YOUR SESSION</p>
          <h2>Writing settings</h2>
        </div>
        <button class="icon-button" type="button" aria-label="Close settings" @click="settingsOpen = false">×</button>
      </div>
      <label class="setting-field">
        <span>Prompt mode</span>
        <select v-model="draft.mode">
          <option value="instruct">Instruct (chat)</option>
          <option value="continue">Continue (raw)</option>
        </select>
        <small>Chat gives the model a writing role; raw mode continues a single text prompt.</small>
      </label>
      <label class="setting-field">
        <span>Temperature <b>{{ Number(draft.temperature).toFixed(2) }}</b></span>
        <input v-model.number="draft.temperature" type="range" min="0" max="2" step="0.05">
        <small>Higher values make the writing more surprising.</small>
      </label>
      <label class="setting-field">
        <span>Maximum new tokens</span>
        <input v-model.number="draft.maxTokens" type="number" min="20" max="8192" step="50">
      </label>
      <label class="setting-field">
        <span>Context size <b>{{ draft.numCtx.toLocaleString() }} tokens</b></span>
        <input v-model.number="draft.numCtx" type="number" min="512" max="131072" step="512">
      </label>
      <label class="setting-field">
        <span>Repeat penalty <b>{{ Number(draft.repeatPenalty).toFixed(2) }}</b></span>
        <input v-model.number="draft.repeatPenalty" type="range" min="1" max="2" step="0.05">
      </label>
      <label class="setting-field">
        <span>Recent paragraphs kept in full</span>
        <input v-model.number="draft.writerParagraphs" type="number" min="1" max="12" step="1">
        <small>Newer paragraphs stay verbatim; older sections are summarized.</small>
      </label>
      <label class="setting-field">
        <span>Paragraphs per summary section</span>
        <input v-model.number="draft.sectionParagraphs" type="number" min="1" max="12" step="1">
      </label>
      <p v-if="selectedModelSize" class="settings-note">
        Selected model size: {{ (selectedModelSize / 1_000_000_000).toFixed(1) }} GB
      </p>
    </section>
  </header>
</template>
