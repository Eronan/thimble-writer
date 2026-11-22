<script setup lang="ts">
import { computed } from 'vue'
import type { ContextGroup, ContextItem } from '~/utils/loreWorkspace'

const props = defineProps<{
  items: ContextItem[]
  busy: boolean
  modelAvailable: boolean
  selecting: boolean
  pickNote: string
  canUndoPick: boolean
}>()
const emit = defineEmits<{
  autoPick: []
  undoPick: []
}>()

// Unticked ids. Stored as exclusions so anything added later is included by default.
const disabledIds = defineModel<string[]>({ required: true })
// "Do this as well" when writing: let the model re-tick the entries before each Write next.
const autoPickOnWrite = defineModel<boolean>('autoPickOnWrite', { required: true })

const groups: { key: ContextGroup; title: string }[] = [
  { key: 'synopsis', title: 'Synopsis' },
  { key: 'guidance', title: 'Writing guidance' },
  { key: 'characters', title: 'Characters' },
  { key: 'setting', title: 'Setting' },
]

const disabled = computed(() => new Set(disabledIds.value))
const visibleGroups = computed(() => groups
  .map(group => ({ ...group, items: props.items.filter(item => item.group === group.key) }))
  .filter(group => group.items.length))
const selectedCount = computed(() => props.items.filter(item => !disabled.value.has(item.id)).length)
const selectedChars = computed(() => props.items
  .filter(item => !disabled.value.has(item.id))
  .reduce((total, item) => total + item.text.length, 0))

function toggle(id: string) {
  const next = new Set(disabled.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  disabledIds.value = [...next]
}

function setGroup(ids: string[], included: boolean) {
  const next = new Set(disabled.value)
  for (const id of ids) {
    if (included) next.delete(id)
    else next.add(id)
  }
  disabledIds.value = [...next]
}

function groupState(groupItems: ContextItem[]) {
  const on = groupItems.filter(item => !disabled.value.has(item.id)).length
  return `${on}/${groupItems.length}`
}

function preview(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat
}
</script>

<template>
  <section class="context-selector" aria-label="Context for the next scene">
    <div class="memory-heading">
      <div>
        <p class="eyebrow">NEXT SCENE</p>
        <h1>Context</h1>
      </div>
      <span class="count-pill">{{ selectedCount }}/{{ items.length }}</span>
    </div>
    <p class="section-description">
      Tick what the next scene can draw on. Only ticked entries are offered to the lore selector.
    </p>
    <div v-if="items.length" class="context-autopick">
      <button
        class="autopick-button"
        type="button"
        :disabled="busy || selecting || !modelAvailable"
        @click="emit('autoPick')"
      >
        {{ selecting ? 'Choosing context…' : 'Auto-pick from recent story' }}
      </button>
      <label class="autopick-toggle">
        <input v-model="autoPickOnWrite" type="checkbox" :disabled="busy || selecting">
        <span>Also auto-pick when I write next</span>
      </label>
      <p class="autopick-help">
        Ticks what the next scene needs and unticks the rest, using your latest paragraphs, recent scenes and the writing prompt.
      </p>
      <p v-if="pickNote" class="autopick-note" role="status">
        {{ pickNote }}
        <button v-if="canUndoPick" class="autopick-undo" type="button" :disabled="busy || selecting" @click="emit('undoPick')">Undo</button>
      </p>
    </div>
    <div v-if="items.length" class="context-actions">
      <button type="button" :disabled="busy" @click="setGroup(items.map(item => item.id), true)">All</button>
      <button type="button" :disabled="busy" @click="setGroup(items.map(item => item.id), false)">None</button>
      <span class="context-size">{{ selectedChars.toLocaleString() }} chars</span>
    </div>
    <div v-if="items.length" class="context-groups">
      <fieldset v-for="group in visibleGroups" :key="group.key" class="context-group">
        <legend>
          <span>{{ group.title }}</span>
          <span class="context-group-count">{{ groupState(group.items) }}</span>
        </legend>
        <div class="context-group-actions">
          <button type="button" :disabled="busy" @click="setGroup(group.items.map(item => item.id), true)">All</button>
          <button type="button" :disabled="busy" @click="setGroup(group.items.map(item => item.id), false)">None</button>
        </div>
        <label
          v-for="item in group.items"
          :key="item.id"
          class="context-item"
          :class="{ 'context-item-off': disabled.has(item.id) }"
        >
          <input
            type="checkbox"
            :checked="!disabled.has(item.id)"
            :disabled="busy"
            @change="toggle(item.id)"
          >
          <span class="context-item-body">
            <span class="context-item-label">{{ item.label }}</span>
            <span class="context-item-preview">{{ preview(item.text) }}</span>
          </span>
        </label>
      </fieldset>
    </div>
    <div v-else class="memory-empty">
      <span aria-hidden="true">✦</span>
      <p>Add synopsis, guidance, characters or settings in the Lore tab and they will be listed here.</p>
    </div>
  </section>
</template>
