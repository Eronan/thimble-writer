<script setup lang="ts">
import type { LoreNote } from '~/utils/loreWorkspace'

const synopsis = defineModel<string>('synopsis', { required: true })
const guidance = defineModel<string>('guidance', { required: true })
const characters = defineModel<LoreNote[]>('characters', { required: true })
const setting = defineModel<LoreNote[]>('setting', { required: true })

function createEntry(): LoreNote {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: '',
    details: '',
    appearance: '',
  }
}

function addCharacter() {
  characters.value = [...characters.value, createEntry()]
}

function addSetting() {
  setting.value = [...setting.value, createEntry()]
}

function removeCharacter(id: string) {
  characters.value = characters.value.filter(character => character.id !== id)
}

function removeSetting(id: string) {
  setting.value = setting.value.filter(place => place.id !== id)
}
</script>

<template>
  <section class="lore-workspace">
    <header class="lore-workspace-heading">
      <div>
        <p class="eyebrow">YOUR STORY BIBLE</p>
        <h1>Lore</h1>
        <p class="section-description">Keep enduring story details separate from the prose you are writing.</p>
      </div>
    </header>

    <section class="lore-section-card">
      <div class="lore-section-group">
        <h2>Story setup</h2>
        <label class="lore-field">
          <span>Synopsis</span>
          <textarea
            v-model="synopsis"
            aria-label="Story synopsis"
            placeholder="The premise, central conflict, and where the story is headed…"
            rows="4"
          />
        </label>
        <label class="lore-field">
          <span>Writing guidance</span>
          <textarea
            v-model="guidance"
            aria-label="Story writing guidance"
            placeholder="Voice, themes, style, or constraints to keep in mind…"
            rows="3"
          />
        </label>
      </div>
    </section>

    <section class="lore-section-card">
      <div class="lore-section-group">
        <header class="lore-list-heading">
          <h2>Characters</h2>
          <button class="lore-add-button" type="button" @click="addCharacter">Add character</button>
        </header>
        <article v-for="(character, index) in characters" :key="character.id" class="lore-entry-card">
          <header class="lore-entry-heading">
            <h3>{{ character.name.trim() || `Character ${index + 1}` }}</h3>
            <button
              class="lore-remove-button"
              type="button"
              :aria-label="`Remove character ${character.name.trim() || index + 1}`"
              @click="removeCharacter(character.id)"
            >Remove</button>
          </header>
          <label class="lore-field">
            <span>Name</span>
            <input v-model="character.name" :aria-label="`Character ${index + 1} name`" placeholder="Character name">
          </label>
          <label class="lore-field">
            <span>Details</span>
            <textarea
              v-model="character.details"
              :aria-label="`Character ${index + 1} details`"
              placeholder="Appearance, personality, history, motivations, relationships…"
              rows="4"
            />
          </label>
          <label class="lore-field">
            <span>Appearance <small>(optional)</small></span>
            <textarea
              v-model="character.appearance"
              :aria-label="`Character ${index + 1} appearance`"
              placeholder="Physical description or other visual details, if relevant…"
              rows="2"
            />
          </label>
        </article>
        <p v-if="!characters.length" class="lore-empty-state">No characters yet. Add one to start keeping track.</p>
      </div>
    </section>

    <section class="lore-section-card">
      <div class="lore-section-group">
        <header class="lore-list-heading">
          <h2>Setting</h2>
          <button class="lore-add-button" type="button" @click="addSetting">Add setting</button>
        </header>
        <article v-for="(place, index) in setting" :key="place.id" class="lore-entry-card">
          <header class="lore-entry-heading">
            <h3>{{ place.name.trim() || `Setting ${index + 1}` }}</h3>
            <button
              class="lore-remove-button"
              type="button"
              :aria-label="`Remove setting ${place.name.trim() || index + 1}`"
              @click="removeSetting(place.id)"
            >Remove</button>
          </header>
          <label class="lore-field">
            <span>Name</span>
            <input v-model="place.name" :aria-label="`Setting ${index + 1} name`" placeholder="Place or world detail">
          </label>
          <label class="lore-field">
            <span>Details</span>
            <textarea
              v-model="place.details"
              :aria-label="`Setting ${index + 1} details`"
              placeholder="Describe its history, atmosphere, rules, or significance…"
              rows="4"
            />
          </label>
        </article>
        <p v-if="!setting.length" class="lore-empty-state">No setting notes yet. Add one to start describing the world.</p>
      </div>
    </section>

    <p class="lore-section-tip">Character and setting entries stay separate in your story bible and are sent as plain-text notes when writing.</p>
  </section>
</template>
