<script setup lang="ts">
import { createContextSection, type ContextSection } from '~/utils/loreWorkspace'

const props = defineProps<{
  heading: string
  singular: string
  placeholder: string
  idPrefix: string
  busy: boolean
}>()

const sections = defineModel<ContextSection[]>({ required: true })

function addSection() {
  const id = globalThis.crypto?.randomUUID?.() ?? `${props.idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  sections.value = [...sections.value, createContextSection(id)]
}

function removeSection(id: string) {
  sections.value = sections.value.filter(section => section.id !== id)
}
</script>

<template>
  <div class="context-section-list">
    <header class="lore-list-heading">
      <h2>{{ heading }}</h2>
      <button class="lore-add-button" type="button" :disabled="busy" @click="addSection">Add {{ singular }} section</button>
    </header>
    <article v-for="(section, index) in sections" :key="section.id" class="lore-entry-card">
      <header class="lore-entry-heading">
        <input
          v-model="section.title"
          class="context-section-title"
          :disabled="busy"
          :aria-label="`${heading} section ${index + 1} title`"
          :placeholder="`Section title (e.g. ${singular === 'synopsis' ? 'Premise, Act two, Ending' : 'Voice, Themes, Avoid'})`"
        >
        <button
          class="lore-remove-button"
          type="button"
          :disabled="busy"
          :aria-label="`Remove ${singular} section ${section.title.trim() || index + 1}`"
          @click="removeSection(section.id)"
        >Remove</button>
      </header>
      <textarea
        v-model="section.text"
        class="context-section-text"
        :disabled="busy"
        :aria-label="`${heading} section ${index + 1} text`"
        :placeholder="placeholder"
        rows="4"
      />
    </article>
    <p v-if="!sections.length" class="lore-empty-state">No {{ singular }} sections yet. Add one to start.</p>
  </div>
</template>
