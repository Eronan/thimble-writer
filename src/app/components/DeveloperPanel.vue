<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  clearDebugEntries,
  debugEntries,
  diagnoseEntry,
  isDebugProblem,
  type DebugEntry,
  type DebugStatus,
} from '~/clients/debugLog'

// A live log of every request sent to Ollama and the raw text that came back, so that replies
// the app fails to turn into structured data can be inspected instead of guessed at.
const problemsOnly = ref(false)
const labelFilter = ref('')
const openIds = ref<Set<number>>(new Set())

const labels = computed(() => [...new Set(debugEntries.map(entry => entry.label))].sort())
const problemCount = computed(() => debugEntries.filter(isDebugProblem).length)
const visible = computed(() => debugEntries.filter(entry =>
  (!problemsOnly.value || isDebugProblem(entry)) && (!labelFilter.value || entry.label === labelFilter.value)))

const statusText: Record<DebugStatus, string> = {
  running: 'Running',
  ok: 'OK',
  'parse-failed': 'Could not parse',
  error: 'Error',
  aborted: 'Cancelled',
}

function onToggle(id: number, event: Event) {
  const next = new Set(openIds.value)
  if ((event.target as HTMLDetailsElement).open) next.add(id)
  else next.delete(id)
  openIds.value = next
}

function prettyJson(text: string): string | null {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  if (!/^[\[{]/.test(body)) return null
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return null
  }
}

function details(entry: DebugEntry) {
  return {
    hints: diagnoseEntry(entry),
    pretty: prettyJson(entry.response),
    options: JSON.stringify(entry.request.options, null, 2),
    format: entry.request.format ? JSON.stringify(entry.request.format, null, 2) : '',
  }
}

function meta(entry: DebugEntry) {
  const parts = [entry.model, new Date(entry.startedAt).toLocaleTimeString()]
  if (entry.durationMs !== null) parts.push(`${(entry.durationMs / 1000).toFixed(1)}s`)
  if (entry.meta.promptTokens !== undefined) parts.push(`${entry.meta.promptTokens} prompt tokens`)
  if (entry.meta.replyTokens !== undefined) parts.push(`${entry.meta.replyTokens} reply tokens`)
  if (entry.meta.doneReason) parts.push(`done: ${entry.meta.doneReason}`)
  return parts.join(' · ')
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text)
}

function requestJson(entry: DebugEntry) {
  return JSON.stringify({ model: entry.model, endpoint: entry.endpoint, ...entry.request }, null, 2)
}
</script>

<template>
  <section class="dev-panel">
    <header class="dev-header">
      <div>
        <p class="eyebrow">ADVANCED</p>
        <h1>Developer log</h1>
        <p class="dev-intro">
          Every request sent to Ollama and the raw reply, newest first. Use it to see what a model really returned when
          the app could not turn it into structured data. Kept in memory only: it is cleared when you reload the page.
        </p>
      </div>
      <div class="dev-controls">
        <label class="dev-check"><input v-model="problemsOnly" type="checkbox"> Problems only <span>{{ problemCount }}</span></label>
        <select v-model="labelFilter" aria-label="Filter by request type">
          <option value="">All request types</option>
          <option v-for="label in labels" :key="label" :value="label">{{ label }}</option>
        </select>
        <button type="button" class="undo-button" :disabled="!debugEntries.length" @click="clearDebugEntries()">Clear log</button>
      </div>
    </header>

    <p v-if="!debugEntries.length" class="dev-empty">Nothing logged yet. Write something, summarise, or proofread, and the requests appear here.</p>
    <p v-else-if="!visible.length" class="dev-empty">No requests match these filters.</p>

    <details
      v-for="entry in visible"
      :key="entry.id"
      class="dev-entry"
      :class="`dev-${entry.status}`"
      :open="openIds.has(entry.id)"
      @toggle="onToggle(entry.id, $event)"
    >
      <summary>
        <span class="dev-badge">{{ statusText[entry.status] }}</span>
        <strong>{{ entry.label }}</strong>
        <span class="dev-meta">{{ meta(entry) }}</span>
      </summary>

      <div v-if="openIds.has(entry.id)" class="dev-body">
        <template v-for="info in [details(entry)]" :key="entry.id">
          <section v-if="info.hints.length">
            <h3>What may be wrong</h3>
            <ul class="dev-hints"><li v-for="hint in info.hints" :key="hint">{{ hint }}</li></ul>
          </section>

          <section v-if="entry.error">
            <h3>{{ entry.status === 'parse-failed' ? 'Parser error' : 'Error' }}</h3>
            <pre>{{ entry.error }}</pre>
          </section>

          <section>
            <h3>
              Raw response <span>{{ entry.response.length }} characters</span>
              <button type="button" class="undo-button" @click="copy(entry.response)">Copy</button>
            </h3>
            <pre>{{ entry.response || '(empty)' }}</pre>
          </section>

          <section v-if="info.pretty">
            <h3>Response as formatted JSON</h3>
            <pre>{{ info.pretty }}</pre>
          </section>

          <section>
            <h3>
              Request <span>{{ entry.endpoint }}</span>
              <button type="button" class="undo-button" @click="copy(requestJson(entry))">Copy as JSON</button>
            </h3>
            <template v-if="entry.request.messages">
              <div v-for="(message, index) in entry.request.messages" :key="index" class="dev-message">
                <h4>{{ message.role }}</h4>
                <pre>{{ message.content }}</pre>
              </div>
            </template>
            <div v-if="entry.request.prompt !== undefined" class="dev-message">
              <h4>prompt</h4>
              <pre>{{ entry.request.prompt }}</pre>
            </div>
            <div class="dev-message">
              <h4>options</h4>
              <pre>{{ info.options }}</pre>
            </div>
            <div v-if="info.format" class="dev-message">
              <h4>format (structured output schema)</h4>
              <pre>{{ info.format }}</pre>
            </div>
          </section>
        </template>
      </div>
    </details>
  </section>
</template>
