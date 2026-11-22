import { computed, ref, type Ref } from 'vue'
import { ollamaClient, ollamaRequestOptions } from '~/clients/ollamaClient'
import type { Draft, StoryChapter } from '~/types/storyWriter'
import type { ContextItem } from '~/utils/loreWorkspace'
import {
  applyContextSelection,
  buildContextSelectionRequest,
  contextSelectionResponseFormat,
  parseContextSelectionResponse,
} from '~/utils/contextSelection'

type ContextSelectionOptions = {
  draft: Draft
  chapter: Readonly<Ref<StoryChapter>>
  items: Readonly<Ref<ContextItem[]>>
  error: Ref<string>
  status: Ref<string>
  // Evaluated when a pick is requested: true while another long-running action owns the draft.
  busy: () => boolean
}

export type ContextPickOutcome =
  | { kind: 'empty' }
  | { kind: 'none' }
  | { kind: 'applied'; ticked: number; total: number; changed: number }

const tickKey = (ids: string[]) => [...ids].sort().join('\u0000')

// Lets the model choose which setup entries are ticked for the next scene, from the writing
// prompt, the chapter synopsis, the last few scene summaries and the newest paragraphs. The ticks
// it sets are the ordinary ones in `draft.disabledContextIds`, so everything downstream (the
// context preview, the lore selector, saving) treats them like manual ticks.
export function useContextSelection(options: ContextSelectionOptions) {
  const { draft, chapter, items, error, status } = options
  const selectingContext = ref(false)
  const contextPickNote = ref('')
  const previousDisabledIds = ref<string[] | null>(null)
  const appliedKey = ref('')

  // Undo is only offered while the ticks are still exactly what the pick left, so it can never
  // roll back changes the writer made by hand afterwards.
  const canUndoContextPick = computed(() =>
    previousDisabledIds.value !== null && tickKey(draft.disabledContextIds) === appliedKey.value,
  )

  // The shared core: also called by Write next, which supplies its own abort signal.
  async function runContextSelection(signal?: AbortSignal): Promise<ContextPickOutcome> {
    const entries = items.value
    if (!entries.length) return { kind: 'empty' }
    const request = buildContextSelectionRequest({
      items: entries,
      story: chapter.value.story,
      summaries: chapter.value.summaries,
      prompt: draft.prompt,
      chapterSynopsis: chapter.value.synopsis,
      writerParagraphs: draft.writerParagraphs,
      numCtx: draft.numCtx,
    })
    const selected = await ollamaClient.chat({
      label: 'Context selection',
      model: draft.model,
      options: ollamaRequestOptions(draft, {
        temperature: Math.min(draft.temperature, 0.3),
        maxTokens: request.outputTokens,
        repeatPenalty: null,
      }),
      format: contextSelectionResponseFormat,
      parse: text => parseContextSelectionResponse(text, entries.length),
      signal,
      messages: request.messages,
    })
    // An empty answer would untick everything and wipe out hand-made ticks, so it is treated as
    // "no answer" rather than "nothing is relevant".
    if (!selected.length) {
      contextPickNote.value = 'The model selected nothing, so your ticks were left as they are'
      return { kind: 'none' }
    }
    const result = applyContextSelection(entries, selected, draft.disabledContextIds)
    if (result.changed) {
      previousDisabledIds.value = [...draft.disabledContextIds]
      draft.disabledContextIds = result.disabledIds
      appliedKey.value = tickKey(result.disabledIds)
    } else {
      previousDisabledIds.value = null
    }
    contextPickNote.value = `Ticked ${result.ticked} of ${result.total}${result.changed ? ` (${result.changed} changed)` : ' (no changes)'}`
    return { kind: 'applied', ticked: result.ticked, total: result.total, changed: result.changed }
  }

  async function autoPickContext() {
    if (selectingContext.value || options.busy()) return
    if (!draft.model) {
      error.value = 'Choose an Ollama model before auto-picking context.'
      return
    }
    if (!items.value.length) return
    selectingContext.value = true
    error.value = ''
    status.value = 'Choosing context…'
    try {
      await runContextSelection()
      status.value = contextPickNote.value
    } catch (cause) {
      error.value = cause instanceof Error ? `Context selection failed: ${cause.message}` : 'Context selection failed.'
      status.value = ''
    } finally {
      selectingContext.value = false
    }
  }

  function undoContextPick() {
    if (!canUndoContextPick.value || !previousDisabledIds.value) return
    draft.disabledContextIds = previousDisabledIds.value
    previousDisabledIds.value = null
    contextPickNote.value = ''
    status.value = 'Restored your previous ticks'
  }

  return {
    selectingContext,
    contextPickNote,
    canUndoContextPick,
    runContextSelection,
    autoPickContext,
    undoContextPick,
  }
}
