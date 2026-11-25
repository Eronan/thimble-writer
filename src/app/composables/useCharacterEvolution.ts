import { computed, ref, shallowRef, type Ref } from 'vue'
import { ollamaClient, ollamaRequestOptions } from '~/clients/ollamaClient'
import type { Draft } from '~/types/storyWriter'
import {
  applyEvolutionChanges,
  buildEvolutionRequest,
  describeEvolutionSkips,
  evolutionResponseFormat,
  parseEvolutionResponse,
  validateEvolutionChanges,
  type EvolutionChange,
  type EvolutionSkips,
} from '~/utils/characterEvolution'

export type EvolutionProposal = EvolutionChange & {
  id: string
  characterId: string
  characterName: string
  chapterId: string
  chapterTitle: string
  // Ticked proposals are the ones Apply will write. The writer can also edit `new` before applying.
  selected: boolean
}

type FieldSnapshot = { id: string; details: string; appearance: string }

type CharacterEvolutionOptions = {
  draft: Draft
  error: Ref<string>
  status: Ref<string>
  // Evaluated on each action: true while another long-running action owns the draft.
  busy: () => boolean
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

// Suggests lasting character updates from a chapter. Nothing is written until the writer ticks
// proposals and applies them; applying edits the character entries in place, and the last applied
// batch can be undone for as long as the entries are untouched afterwards.
export function useCharacterEvolution(options: CharacterEvolutionOptions) {
  const { draft, error, status } = options
  const running = ref(false)
  const progress = ref('')
  const note = ref('')
  const proposals = ref<EvolutionProposal[]>([])
  const failures = ref<string[]>([])
  const controller = shallowRef<AbortController | null>(null)
  const previousFields = ref<FieldSnapshot[] | null>(null)
  const appliedKey = ref('')

  const fieldsKey = () => JSON.stringify(draft.characters.map(character => [character.id, character.details, character.appearance ?? '']))
  const canUndoEvolution = computed(() => previousFields.value !== null && fieldsKey() === appliedKey.value)

  async function runEvolution(chapterId: string, characterIds: string[]) {
    if (running.value || options.busy()) return
    if (!draft.model) {
      error.value = 'Choose an Ollama model before evolving characters.'
      return
    }
    const chapter = draft.chapters.find(item => item.id === chapterId)
    if (!chapter?.story.trim()) {
      error.value = 'Choose a chapter that has story text.'
      return
    }
    const characters = characterIds.flatMap(id => draft.characters.find(character => character.id === id) ?? [])
    if (!characters.length) return

    running.value = true
    error.value = ''
    failures.value = []
    note.value = ''
    const abort = new AbortController()
    controller.value = abort
    const skipped: EvolutionSkips = { evidence: 0, unmatched: 0, duplicate: 0, size: 0, limit: 0 }
    let proposed = 0
    let charactersWithChanges = 0
    let quiet = 0
    let notMentioned = 0
    let stopped = false

    try {
      for (const [index, character] of characters.entries()) {
        const name = character.name.trim() || 'Unnamed character'
        progress.value = `Reading ${name} (${index + 1} of ${characters.length})…`
        status.value = progress.value
        try {
          const request = buildEvolutionRequest({
            character,
            chapterStory: chapter.story,
            summaries: chapter.summaries,
            numCtx: draft.numCtx,
          })
          if (!request) {
            notMentioned++
            continue
          }
          const parsed = await ollamaClient.chat({
            label: 'Character evolution',
            model: draft.model,
            options: ollamaRequestOptions(draft, {
              temperature: 0.3,
              maxTokens: request.outputTokens,
              repeatPenalty: null,
            }),
            format: evolutionResponseFormat,
            parse: parseEvolutionResponse,
            signal: abort.signal,
            messages: request.messages,
          })
          const validated = validateEvolutionChanges(
            { details: character.details, appearance: character.appearance ?? '' },
            chapter.story,
            parsed.changes,
          )
          for (const key of Object.keys(skipped) as Array<keyof EvolutionSkips>) skipped[key] += validated.skipped[key]
          // A fresh run for the same character and chapter replaces its earlier pending proposals.
          proposals.value = proposals.value.filter(item => !(item.characterId === character.id && item.chapterId === chapter.id))
          proposals.value.push(...validated.changes.map(change => ({
            ...change,
            id: newId(),
            characterId: character.id,
            characterName: name,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            selected: true,
          })))
          proposed += validated.changes.length
          if (validated.changes.length) charactersWithChanges++
          else quiet++
        } catch (cause) {
          if (cause instanceof Error && cause.name === 'AbortError') throw cause
          failures.value.push(`${name}: ${cause instanceof Error ? cause.message : 'unknown error'}`)
        }
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') stopped = true
      else throw cause
    } finally {
      running.value = false
      controller.value = null
      progress.value = ''
    }

    const dropped = describeEvolutionSkips(skipped)
    const parts = [
      proposed
        ? `Found ${proposed} proposed change${proposed === 1 ? '' : 's'} for ${charactersWithChanges} character${charactersWithChanges === 1 ? '' : 's'}`
        : 'No lasting changes found',
      quiet && proposed ? `${quiet} had nothing lasting to record` : '',
      notMentioned ? `${notMentioned} not mentioned in the chapter` : '',
      dropped ? `dropped ${dropped}` : '',
      failures.value.length ? `${failures.value.length} failed` : '',
    ].filter(Boolean)
    status.value = stopped ? `Stopped. ${parts.join('; ')}` : parts.join('; ')
  }

  function stopEvolution() {
    controller.value?.abort()
  }

  // Writes only the ticked proposals, each located in its entry as it is now. Proposals that no
  // longer fit (the entry changed) or that overlap another ticked change stay in the review.
  function applyEvolution() {
    if (running.value || options.busy()) return
    const chosen = proposals.value.filter(item => item.selected)
    if (!chosen.length) return

    const before: FieldSnapshot[] = []
    const appliedIds = new Set<string>()
    let notApplied = 0
    let charactersChanged = 0
    for (const characterId of new Set(chosen.map(item => item.characterId))) {
      const mine = chosen.filter(item => item.characterId === characterId)
      const character = draft.characters.find(item => item.id === characterId)
      if (!character) {
        notApplied += mine.length
        continue
      }
      const result = applyEvolutionChanges({ details: character.details, appearance: character.appearance ?? '' }, mine)
      notApplied += result.failed.length
      if (!result.applied.length) continue
      before.push({ id: character.id, details: character.details, appearance: character.appearance ?? '' })
      character.details = result.details
      character.appearance = result.appearance
      for (const id of result.applied) appliedIds.add(id)
      charactersChanged++
    }
    if (!appliedIds.size) {
      error.value = 'None of the ticked changes still fit their entries. Dismiss them or run again.'
      return
    }
    proposals.value = proposals.value.filter(item => !appliedIds.has(item.id))
    previousFields.value = before
    appliedKey.value = fieldsKey()
    error.value = ''
    note.value = `Applied ${appliedIds.size} change${appliedIds.size === 1 ? '' : 's'} to ${charactersChanged} character${charactersChanged === 1 ? '' : 's'}${notApplied ? `; ${notApplied} could not be applied` : ''}`
    status.value = note.value
  }

  function undoEvolution() {
    if (!canUndoEvolution.value || !previousFields.value) return
    for (const snapshot of previousFields.value) {
      const character = draft.characters.find(item => item.id === snapshot.id)
      if (!character) continue
      character.details = snapshot.details
      character.appearance = snapshot.appearance
    }
    previousFields.value = null
    note.value = 'Reverted the last applied changes'
    status.value = note.value
  }

  const dismissEvolution = (id: string) => {
    proposals.value = proposals.value.filter(item => item.id !== id)
  }

  function clearEvolution() {
    proposals.value = []
    failures.value = []
    note.value = ''
    previousFields.value = null
  }

  return {
    evolving: running,
    evolutionProgress: progress,
    evolutionNote: note,
    evolutionProposals: proposals,
    evolutionFailures: failures,
    canUndoEvolution,
    runEvolution,
    stopEvolution,
    applyEvolution,
    undoEvolution,
    dismissEvolution,
    clearEvolution,
  }
}
