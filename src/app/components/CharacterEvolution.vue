<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EvolutionProposal } from '~/composables/useCharacterEvolution'
import { evaluateEvolutionChanges, findMentionedCharacters, type EvolutionState } from '~/utils/characterEvolution'
import type { StoryChapter } from '~/types/storyWriter'
import type { LoreNote } from '~/utils/loreWorkspace'

const props = defineProps<{
  characters: LoreNote[]
  chapters: StoryChapter[]
  defaultChapterId: string
  failures: string[]
  running: boolean
  progress: string
  note: string
  canUndo: boolean
  busy: boolean
  modelAvailable: boolean
}>()

const emit = defineEmits<{
  run: [chapterId: string, characterIds: string[]]
  stop: []
  apply: []
  dismiss: [id: string]
  clear: []
  undo: []
}>()

// Edited in place (the writer can reword a proposal's new text, and ticks live on each proposal).
const proposals = defineModel<EvolutionProposal[]>('proposals', { required: true })

const chapterId = ref(props.chapters.some(chapter => chapter.id === props.defaultChapterId)
  ? props.defaultChapterId
  : props.chapters[0]?.id ?? '')
const chosenIds = ref(new Set<string>())

const chapter = computed(() => props.chapters.find(item => item.id === chapterId.value))
const mentions = computed(() => findMentionedCharacters(chapter.value?.story ?? '', props.characters))

// Whoever the chapter names starts out ticked; the writer decides from there.
watch([chapterId, () => props.characters.length], () => {
  chosenIds.value = new Set(mentions.value.keys())
}, { immediate: true })

function toggleCharacter(id: string) {
  const next = new Set(chosenIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  chosenIds.value = next
}

const chosenCount = computed(() => [...chosenIds.value].filter(id => mentions.value.has(id)).length)

function run() {
  emit('run', chapterId.value, [...chosenIds.value].filter(id => mentions.value.has(id)))
}

type Group = {
  characterId: string
  name: string
  proposals: EvolutionProposal[]
  states: Map<string, EvolutionState>
}

const groups = computed<Group[]>(() => {
  const order = [...new Set(proposals.value.map(item => item.characterId))]
  return order.map((characterId) => {
    const mine = proposals.value.filter(item => item.characterId === characterId)
    const character = props.characters.find(item => item.id === characterId)
    const states = character
      ? evaluateEvolutionChanges(
        { details: character.details, appearance: character.appearance ?? '' },
        mine,
      )
      : new Map(mine.map(item => [item.id, 'stale' as EvolutionState]))
    return { characterId, name: mine[0]?.characterName ?? 'Character', proposals: mine, states }
  })
})

const stateOf = (group: Group, proposal: EvolutionProposal): EvolutionState => group.states.get(proposal.id) ?? 'stale'
const applicableCount = computed(() => groups.value.reduce(
  (total, group) => total + group.proposals.filter(item => item.selected && stateOf(group, item) === 'ready').length,
  0,
))
const tickedIn = (group: Group) => group.proposals.filter(item => item.selected && stateOf(group, item) === 'ready').length

function setGroupSelected(group: Group, selected: boolean) {
  for (const proposal of group.proposals) {
    if (stateOf(group, proposal) === 'ready' || !selected) proposal.selected = selected
  }
}

function setAllSelected(selected: boolean) {
  for (const group of groups.value) setGroupSelected(group, selected)
}

function clearAll() {
  if (!proposals.value.length) return
  if (!window.confirm(`Dismiss all ${proposals.value.length} proposed change${proposals.value.length === 1 ? '' : 's'}? Your characters are not changed.`)) return
  emit('clear')
}

const fieldName = { details: 'Details', appearance: 'Appearance' } as const
const opName = { add: 'Add', replace: 'Replace', remove: 'Remove' } as const
const stateLabel: Record<Exclude<EvolutionState, 'ready'>, string> = {
  stale: 'Entry changed since',
  duplicate: 'Already in the entry',
  conflict: 'Overlaps another ticked change',
}
</script>

<template>
  <section class="lore-section-card evolution" aria-labelledby="evolution-heading">
    <div class="lore-section-group">
      <header class="lore-list-heading">
        <h2 id="evolution-heading">Evolve characters</h2>
        <span v-if="proposals.length" class="count-pill">{{ proposals.length }} proposed</span>
      </header>
      <p class="evolution-help">
        After a chapter, the model suggests lasting updates to your characters. Nothing changes until you tick the
        changes you want and apply them, and you can reword any suggestion first.
      </p>

      <div class="evolution-setup">
        <label class="evolution-chapter">
          <span>Chapter</span>
          <select v-model="chapterId" :disabled="busy">
            <option v-for="item in chapters" :key="item.id" :value="item.id" :disabled="!item.story.trim()">
              {{ item.title || 'Untitled chapter' }}{{ item.story.trim() ? '' : ' (no story yet)' }}
            </option>
          </select>
        </label>
        <fieldset class="evolution-characters">
          <legend>Characters to review</legend>
          <p v-if="!characters.length" class="evolution-muted">Add characters below to evolve them.</p>
          <label
            v-for="character in characters"
            :key="character.id"
            class="evolution-character"
            :class="{ 'evolution-character-off': !mentions.has(character.id) }"
          >
            <input
              type="checkbox"
              :checked="chosenIds.has(character.id) && mentions.has(character.id)"
              :disabled="busy || !mentions.has(character.id)"
              @change="toggleCharacter(character.id)"
            >
            <span>{{ character.name.trim() || 'Unnamed character' }}</span>
            <span class="evolution-muted">
              {{ mentions.has(character.id)
                ? `${mentions.get(character.id)} paragraph${mentions.get(character.id) === 1 ? '' : 's'}`
                : character.name.trim() ? 'not mentioned' : 'needs a name' }}
            </span>
          </label>
        </fieldset>
        <div class="evolution-run">
          <button
            v-if="!running"
            class="lore-add-button"
            type="button"
            :disabled="busy || !modelAvailable || !chosenCount"
            @click="run"
          >Suggest changes for {{ chosenCount }} character{{ chosenCount === 1 ? '' : 's' }}</button>
          <button v-else class="lore-add-button" type="button" @click="emit('stop')">Stop</button>
          <span v-if="running" class="evolution-muted" role="status">{{ progress }}</span>
        </div>
      </div>

      <p v-for="failure in failures" :key="failure" class="error-message" role="alert">{{ failure }}</p>

      <div v-if="groups.length" class="evolution-review">
        <section v-for="group in groups" :key="group.characterId" class="evolution-group">
          <header class="evolution-group-heading">
            <h3>{{ group.name }}</h3>
            <span class="evolution-muted">{{ tickedIn(group) }} of {{ group.proposals.length }} ticked</span>
            <span class="evolution-group-actions">
              <button type="button" :disabled="busy" @click="setGroupSelected(group, true)">All</button>
              <button type="button" :disabled="busy" @click="setGroupSelected(group, false)">None</button>
            </span>
          </header>

          <article
            v-for="proposal in group.proposals"
            :key="proposal.id"
            class="evolution-card"
            :class="{ 'evolution-card-off': !proposal.selected || stateOf(group, proposal) === 'stale' || stateOf(group, proposal) === 'duplicate' }"
          >
            <header class="evolution-card-heading">
              <label class="evolution-tick">
                <input
                  v-model="proposal.selected"
                  type="checkbox"
                  :disabled="busy || stateOf(group, proposal) === 'stale' || stateOf(group, proposal) === 'duplicate'"
                  :aria-label="`Apply this ${opName[proposal.op].toLowerCase()} to ${group.name}'s ${fieldName[proposal.field].toLowerCase()}`"
                >
                <span class="evolution-badge">{{ opName[proposal.op] }}</span>
                <span class="evolution-badge evolution-badge-field">{{ fieldName[proposal.field] }}</span>
              </label>
              <span v-if="stateOf(group, proposal) !== 'ready'" class="memory-stale">{{ stateLabel[stateOf(group, proposal) as Exclude<EvolutionState, 'ready'>] }}</span>
              <button
                class="memory-remove"
                type="button"
                :disabled="busy"
                :aria-label="`Dismiss this proposed change for ${group.name}`"
                @click="emit('dismiss', proposal.id)"
              >×</button>
            </header>

            <p class="evolution-reason">{{ proposal.reason }}</p>
            <p v-if="proposal.op !== 'add'" class="fix-diff fix-removed">
              <span class="fix-sign" aria-hidden="true">−</span><span class="sr-only">Remove </span>{{ proposal.old }}
            </p>
            <label v-if="proposal.op !== 'remove'" class="fix-diff fix-added">
              <span class="fix-sign" aria-hidden="true">+</span>
              <span class="sr-only">New text</span>
              <textarea
                v-model="proposal.new"
                rows="2"
                :disabled="busy"
                :aria-label="`New text for ${group.name}`"
              />
            </label>
            <blockquote class="evolution-evidence">
              <span class="evolution-muted">{{ proposal.chapterTitle || 'Chapter' }}:</span> “{{ proposal.evidence }}”
            </blockquote>
          </article>
        </section>

        <footer class="evolution-footer">
          <button class="evolution-apply" type="button" :disabled="busy || !applicableCount" @click="emit('apply')">
            Apply {{ applicableCount }} ticked change{{ applicableCount === 1 ? '' : 's' }}
          </button>
          <button type="button" class="lore-remove-button" :disabled="busy" @click="setAllSelected(true)">Tick all</button>
          <button type="button" class="lore-remove-button" :disabled="busy" @click="setAllSelected(false)">Tick none</button>
          <button type="button" class="lore-remove-button" :disabled="busy" @click="clearAll">Dismiss all</button>
        </footer>
      </div>

      <p v-if="note" class="evolution-note" role="status">
        {{ note }}
        <button v-if="canUndo" class="lore-remove-button" type="button" :disabled="busy" @click="emit('undo')">Undo</button>
      </p>
    </div>
  </section>
</template>
