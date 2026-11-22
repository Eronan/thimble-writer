import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { locateSection, paragraphsWithOffsets } from '~/utils/storySections'
import { locateFeedback, type StoryFeedback } from '~/utils/storyFeedback'
import { ollamaClient, ollamaRequestOptions, type OllamaModel } from '~/clients/ollamaClient'
import { draftStorage } from '~/clients/draftStorage'
import { buildStoryContext, makeStoryRequest } from '~/utils/storyPrompt'
import { buildFeedbackRevisionContext } from '~/utils/feedbackRevisionPrompt'
import {
  charsForContextBudget,
  FEEDBACK_CONTEXT_RESERVE_TOKENS,
  loreSelectorBudget,
} from '~/utils/contextBudget'
import { migrateDraftData, DRAFT_SCHEMA_VERSION } from '~/utils/draftSchema'
import { draftFileName, parseDraftFile, serializeDraftFile } from '~/utils/draftFile'
import { downloadStory } from '~/utils/storyExport'
import { applyFixesToStory, splitFeedback } from '~/utils/storyFixes'
import type { Draft, FeedbackRevision, StoryChapter } from '~/types/storyWriter'
import {
  fitLoreEntries,
  loreSelectionResponseFormat,
  loreSelectionSystem,
  parseLoreSelectionResponse,
  prepareLoreEntries,
} from '~/utils/storyLore'
import { buildContextItems, createContextSection, formatLoreForPrompt } from '~/utils/loreWorkspace'
import { useStoryProofreading } from './useStoryProofreading'
import { useStorySummaries } from './useStorySummaries'
import { useContextSelection } from './useContextSelection'
import { useChapterSynopsis } from './useChapterSynopsis'
import { useLoreGeneration } from './useLoreGeneration'

const draftSaveDelay = 500
// The continuation should see the actual recent wording for voice and immediate continuity;
// summaries are a memory aid for older events, not a replacement for the current scene.
const defaults: Draft = {
  schemaVersion: DRAFT_SCHEMA_VERSION,
  synopsisSections: [createContextSection('synopsis-1', 'Synopsis')],
  guidanceSections: [createContextSection('guidance-1', 'Writing guidance')],
  disabledContextIds: [],
  autoPickContextOnWrite: false,
  characters: [],
  setting: [],
  chapters: [{
    id: 'chapter-1',
    title: 'Chapter 1',
    synopsis: '',
    story: '',
    summaries: [],
    feedback: [],
    feedbackRevisions: [],
  }],
  activeChapterId: 'chapter-1',
  structurePrompt: '',
  prompt: '',
  model: '',
  mode: 'instruct',
  temperature: 0.8,
  maxTokens: 300,
  numCtx: 4096,
  repeatPenalty: 1.1,
  writerParagraphs: 3,
  sectionParagraphs: 4,
}

export function useStoryWriter() {
  const draft = reactive<Draft>({ ...defaults })
  const activeChapter = computed<StoryChapter>(() => {
    const chapter = draft.chapters.find(item => item.id === draft.activeChapterId)
      ?? draft.chapters[0]
    if (!chapter) throw new Error('The draft must contain at least one chapter.')
    return chapter
  })
  const contextItems = computed(() => buildContextItems(draft))
  // Only the next scene's lore is filtered by the tick boxes; tools that plan or edit the
  // whole story (structure, lore generation, feedback) keep seeing all of it.
  const sceneLore = () => formatLoreForPrompt(draft, new Set(draft.disabledContextIds))
  const models = ref<OllamaModel[]>([])
  const loadingModels = ref(false)
  const generating = ref(false)
  const error = ref('')
  const status = ref('')
  const revisingFeedback = ref(false)
  const canUndo = ref(false)
  const previousStory = ref('')
  let previousFeedback: StoryFeedback[] = []
  let previousFeedbackRevisions: FeedbackRevision[] = []
  const abortController = shallowRef<AbortController | null>(null)
  const selectedModelSize = computed(() => models.value.find(model => model.name === draft.model)?.size)
  const contextPreview = computed(() => {
    const context = buildStoryContext({
      lore: sceneLore(),
      chapterSynopsis: activeChapter.value.synopsis,
      prompt: draft.prompt,
      story: activeChapter.value.story,
      summaries: activeChapter.value.summaries,
      maxTokens: draft.maxTokens,
      numCtx: draft.numCtx,
      writerParagraphs: draft.writerParagraphs,
    })
    const selectorContext = [
      activeChapter.value.synopsis.trim()
        ? `Current chapter synopsis:\n${activeChapter.value.synopsis.trim()}`
        : '',
      context.summaries ? `Most recent summarized story sections:\n${context.summaries}` : '',
      draft.prompt.trim() ? `Current writing direction:\n${draft.prompt.trim()}` : '',
    ].filter(Boolean).join('\n\n')
    const selectorBudget = loreSelectorBudget(
      draft.numCtx,
      selectorContext.length,
      loreSelectionSystem.length,
    )
    const loreText = sceneLore()
    let loreEntries = ''
    let loreError = ''
    if (loreText.trim()) {
      try {
        loreEntries = prepareLoreEntries(loreText, selectorBudget.loreEntriesChars).text
      } catch (cause) {
        loreError = cause instanceof Error ? cause.message : 'Lore entries cannot fit the selection context.'
      }
    }
    return {
      budget: context.budget,
      story: context.story,
      summaries: context.summaries,
      prompt: draft.prompt.trim(),
      chapterSynopsis: context.chapterSynopsis,
      chapterTitle: activeChapter.value.title,
      loreEntries,
      loreError,
      loreSelectorInputChars: selectorBudget.inputChars,
      loreGenerationLimitChars: context.loreBudget,
    }
  })
  let readyToSave = false
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null

  function persistDraft() {
    if (!readyToSave) return
    if (draftSaveTimer !== null) {
      clearTimeout(draftSaveTimer)
      draftSaveTimer = null
    }
    try {
      void draftStorage.save(JSON.stringify(draft)).catch(() => {
        error.value = 'Could not save this draft in browser storage.'
      })
    } catch {
      error.value = 'Could not save this draft in browser storage.'
    }
  }

  function scheduleDraftSave() {
    if (!readyToSave || generating.value) return
    if (draftSaveTimer !== null) clearTimeout(draftSaveTimer)
    draftSaveTimer = setTimeout(persistDraft, draftSaveDelay)
  }

  async function backupDraft(serialized: string, label: string) {
    try {
      await draftStorage.backup(serialized, label)
    } catch {
      // Storage may be full; the primary save is still untouched until autosave runs.
    }
  }

  function applyDraftData(parsed: ReturnType<typeof migrateDraftData>) {
    Object.assign(draft, structuredClone(defaults), parsed)
    // Validate collections separately so older drafts can be upgraded safely.
    if (!draft.chapters.length) {
      draft.chapters = structuredClone(defaults.chapters)
      draft.activeChapterId = draft.chapters[0]!.id
    }
  }

  function exportDraft() {
    const blob = new Blob([serializeDraftFile(draft)], { type: 'application/json;charset=utf-8' })
    downloadStory(blob, draftFileName())
    error.value = ''
    status.value = 'Story saved to a JSON file'
  }

  async function importDraft(file: File) {
    if (isBusy.value) return
    try {
      const parsed = parseDraftFile(await file.text())
      // Park the current story first: importing replaces everything.
      await backupDraft(JSON.stringify(draft), `before-import-${Date.now()}`)
      applyDraftData(parsed)
      if (models.value.length && !models.value.some(model => model.name === draft.model)) {
        draft.model = models.value[0]!.name
      }
      canUndo.value = false
      previousStory.value = ''
      persistDraft()
      error.value = ''
      status.value = `Loaded story from ${file.name}`
    } catch (cause) {
      error.value = cause instanceof Error
        ? `Could not load ${file.name}: ${cause.message}`
        : `Could not load ${file.name}.`
    }
  }

  onMounted(async () => {
    window.addEventListener('pagehide', persistDraft)
    try {
      const saved = await draftStorage.load()
      if (saved) {
        try {
          const raw = JSON.parse(saved) as { schemaVersion?: unknown } | null
          // Keep the untouched save before upgrading it, so a missing or buggy migration
          // can never be the only copy of the story.
          if (raw?.schemaVersion !== DRAFT_SCHEMA_VERSION) {
            await backupDraft(saved, `v${String(raw?.schemaVersion ?? 'none')}`)
          }
          applyDraftData(migrateDraftData(raw))
        } catch (cause) {
          // Autosave would overwrite the unreadable save with an empty draft; stash it first.
          await backupDraft(saved, `unreadable-${Date.now()}`)
          throw cause
        }
      }
    } catch {
      error.value = 'Could not load the saved draft from this browser. The original was kept as a backup in browser storage.'
    } finally {
      readyToSave = true
    }

    await refreshModels()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('pagehide', persistDraft)
    persistDraft()
  })

  // Streaming can update story.value for every token. Debounce those edits and persist once
  // generation settles instead of serializing the full draft on every incremental update.
  watch(draft, scheduleDraftSave, { deep: true })

  async function refreshModels() {
    loadingModels.value = true
    error.value = ''
    try {
      models.value = await ollamaClient.listModels()
      if (!models.value.some(model => model.name === draft.model)) {
        draft.model = models.value[0]?.name ?? ''
      }
      if (!models.value.length) status.value = 'No Ollama models found. Pull a model, then refresh.'
      else status.value = `${models.value.length} model${models.value.length === 1 ? '' : 's'} available`
    } catch {
      error.value = `Can't reach Ollama at ${ollamaClient.baseUrl}. Start Ollama and allow this app's origin with OLLAMA_ORIGINS.`
      status.value = ''
    } finally {
      loadingModels.value = false
    }
  }

  const { summarizing, summarizeOlderSections, resummarizeAllSections } = useStorySummaries({
    draft,
    chapter: activeChapter,
    generating,
    error,
    status,
  })
  const {
    selectingContext,
    contextPickNote,
    canUndoContextPick,
    runContextSelection,
    autoPickContext,
    undoContextPick,
  } = useContextSelection({
    draft,
    chapter: activeChapter,
    items: contextItems,
    error,
    status,
    busy: () => isBusy.value,
  })
  const { proofreading, proofreadStory } = useStoryProofreading({
    draft,
    chapter: activeChapter,
    generating,
    summarizing,
    revisingFeedback,
    error,
    status,
  })
  const {
    busy: chapterSynopsisBusy,
    fixingSynopsis,
    generatingSynopsisId,
    generatingAllStructure,
    fixChapterSynopsis,
    generateChapterSynopsis,
    generateAllChapterStructure,
  } = useChapterSynopsis({
    draft,
    chapter: activeChapter,
    generating,
    summarizing,
    revisingFeedback,
    proofreading,
    error,
    status,
  })
  const {
    busy: loreGenerationBusy,
    generatingLoreId,
    generateLoreEntry,
  } = useLoreGeneration({
    draft,
    generating,
    summarizing,
    revisingFeedback,
    proofreading,
    error,
    status,
  })

  function addFeedback(selection: { start: number; end: number; text: string }, instruction: string) {
    const { start, end, text } = selection
    if (start < 0 || end <= start || end > activeChapter.value.story.length || activeChapter.value.story.slice(start, end) !== text) {
      error.value = 'Select text that is still present in the story before adding feedback.'
      return false
    }
    if (!instruction.trim()) {
      error.value = 'Write a feedback instruction for the selected text.'
      return false
    }
    // Feedback is scoped to the exact selection. Reject overlaps so one queued rewrite cannot
    // silently consume or reshape the passage another comment is meant to address.
    const overlaps = activeChapter.value.feedback.some((comment) => {
      const range = locateFeedback(activeChapter.value.story, comment)
      return range && start < range.end && end > range.start
    })
    if (overlaps) {
      error.value = 'That selection overlaps an existing feedback comment. Remove or revise the existing comment first.'
      return false
    }
    activeChapter.value.feedback.push({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      start,
      source: text,
      kind: 'comment',
      before: activeChapter.value.story.slice(Math.max(0, start - 80), start),
      after: activeChapter.value.story.slice(end, end + 80),
      instruction: instruction.trim(),
    })
    error.value = ''
    status.value = 'Feedback added to the queue'
    return true
  }

  async function applyFeedback(commentId?: string) {
    // Suggested fixes are applied by acceptFixes, never by asking the model to rewrite them.
    const comments = splitFeedback(activeChapter.value.feedback).comments
      .filter(comment => !commentId || comment.id === commentId)
    if (revisingFeedback.value || generating.value || summarizing.value || !comments.length) return
    if (!draft.model) {
      error.value = 'Choose an Ollama model before applying feedback.'
      return
    }

    revisingFeedback.value = true
    error.value = ''
    status.value = commentId ? 'Applying comment…' : 'Applying feedback…'
    previousStory.value = activeChapter.value.story
    previousFeedback = activeChapter.value.feedback.map(comment => ({ ...comment }))
    previousFeedbackRevisions = [...activeChapter.value.feedbackRevisions]
    canUndo.value = false
    let applied = 0
    try {
      // Apply comments in queue order, but re-locate each target against the latest draft because
      // replacing earlier text shifts offsets. Disjoint selections keep each instruction scoped.
      for (const comment of comments) {
        const range = locateFeedback(activeChapter.value.story, comment)
        if (!range) {
          throw new Error(`Could not find the selected passage for feedback: “${comment.source.slice(0, 70)}”`)
        }

        const paragraphs = paragraphsWithOffsets(activeChapter.value.story)
        const firstParagraph = paragraphs.findIndex(paragraph => paragraph.start <= range.start && paragraph.end >= range.start)
        const lastParagraph = paragraphs.findIndex(paragraph => paragraph.start < range.end && paragraph.end >= range.end)
        const contextStart = paragraphs[Math.max(0, firstParagraph - 1)]?.start ?? range.start
        const contextEnd = paragraphs[Math.min(paragraphs.length - 1, Math.max(lastParagraph, 0) + 1)]?.end ?? range.end
        const sectionSummaries = activeChapter.value.summaries
          .map(section => ({ section, range: locateSection(activeChapter.value.story, section) }))
          .filter(item => item.range && item.range.start <= range.end && item.range.end >= range.start)
          .map(item => item.section.summary.trim())
          .filter(Boolean)
        const system = [
          'You are a fiction editor revising a specific passage in a story.',
          'Apply the feedback only to the selected passage. Return only the replacement passage, with no explanation, labels, or quotation marks.',
          'Preserve the surrounding context, point of view, tense, and voice. Do not rewrite or repeat text outside the selected passage.',
          'If the change is purely grammatical, return only the corrected passage. If the change is stylistic, return a polished version that preserves the original meaning.',
        ].join('\n')
        const user = buildFeedbackRevisionContext({
          system,
          lore: [
            activeChapter.value.synopsis.trim()
              ? `Chapter synopsis:\n${activeChapter.value.synopsis.trim()}`
              : '',
            formatLoreForPrompt(draft),
          ].filter(Boolean).join('\n\n'),
          summaries: sectionSummaries,
          surroundingBefore: activeChapter.value.story.slice(contextStart, range.start),
          surroundingAfter: activeChapter.value.story.slice(range.end, contextEnd),
          selectedPassage: comment.source,
          instruction: comment.instruction,
          maxChars: charsForContextBudget(
            draft.numCtx,
            draft.maxTokens,
            FEEDBACK_CONTEXT_RESERVE_TOKENS,
          ),
        })
        const response = await ollamaClient.chat({
          label: 'Apply comment',
          model: draft.model,
          options: ollamaRequestOptions(draft, { temperature: Math.min(draft.temperature, 0.5) }),
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        })
        const replacement = response.trim()
        if (!replacement) throw new Error('Ollama returned an empty passage revision.')

        // The model may read surrounding prose for continuity, but only the user's selected range
        // is replaced so applying feedback cannot unexpectedly rewrite neighboring paragraphs.
        activeChapter.value.story = `${activeChapter.value.story.slice(0, range.start)}${replacement}${activeChapter.value.story.slice(range.end)}`
        activeChapter.value.feedbackRevisions.push({
          id: `${comment.id}-${Date.now().toString(36)}`,
          instruction: comment.instruction,
          before: comment.source,
          after: replacement,
          appliedAt: Date.now(),
        })
        activeChapter.value.feedback = activeChapter.value.feedback.filter(item => item.id !== comment.id)
        applied++
        status.value = `Applied ${applied} comment${applied === 1 ? '' : 's'}`
      }
      status.value = `Applied ${applied} comment${applied === 1 ? '' : 's'}`
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not apply feedback.'
      // Earlier successful edits stay applied, while failed and unattempted comments remain
      // queued so a transient model failure does not lose the user's instructions.
      status.value = applied ? `Applied ${applied}; remaining comments are still queued` : ''
    } finally {
      revisingFeedback.value = false
      canUndo.value = activeChapter.value.story !== previousStory.value
        || activeChapter.value.feedback.length !== previousFeedback.length
        || activeChapter.value.feedbackRevisions.length !== previousFeedbackRevisions.length
    }
  }

  // Fixes carry their own exact replacement, so accepting one is a text swap with no model call.
  // They are located against the current story and spliced together, so the only text that can
  // enter the story is each fix's replacement.
  function acceptFixes(ids?: string[]) {
    if (isBusy.value) return
    const queued = splitFeedback(activeChapter.value.feedback).fixes
    const chosen = ids ? queued.filter(fix => ids.includes(fix.id)) : queued
    if (!chosen.length) return

    const story = activeChapter.value.story
    const result = applyFixesToStory(story, chosen)
    if (!result.applied.length) {
      error.value = 'Those fixes no longer match the story. Dismiss them or proofread again.'
      return
    }
    previousStory.value = story
    previousFeedback = activeChapter.value.feedback.map(comment => ({ ...comment }))
    previousFeedbackRevisions = [...activeChapter.value.feedbackRevisions]

    const appliedAt = Date.now()
    const appliedIds = new Set(result.applied.map(item => item.id))
    activeChapter.value.story = result.story
    activeChapter.value.feedbackRevisions.push(...result.applied.map(item => ({
      id: `${item.id}-${appliedAt.toString(36)}`,
      instruction: item.instruction,
      before: item.before,
      after: item.after,
      appliedAt,
    })))
    activeChapter.value.feedback = activeChapter.value.feedback.filter(comment => !appliedIds.has(comment.id))
    // Replacements shift text, so refresh the remaining comments' position hints.
    for (const comment of activeChapter.value.feedback) {
      const range = locateFeedback(result.story, comment)
      if (range) comment.start = range.start
    }
    canUndo.value = true
    error.value = ''
    const count = result.applied.length
    status.value = `Applied ${count} fix${count === 1 ? '' : 'es'}${result.failed.length ? `; ${result.failed.length} no longer match the story` : ''}`
  }

  async function writeNext() {
    if (generating.value) {
      abortController.value?.abort()
      return
    }
    if (selectingContext.value) return
    if (!draft.model) {
      error.value = 'Choose an Ollama model before writing.'
      return
    }

    error.value = ''
    status.value = 'Writing…'
    generating.value = true
    const controller = new AbortController()
    abortController.value = controller
    const baseStory = activeChapter.value.story
    previousStory.value = baseStory
    previousFeedback = activeChapter.value.feedback.map(comment => ({ ...comment }))
    previousFeedbackRevisions = [...activeChapter.value.feedbackRevisions]
    canUndo.value = false
    // The user's rule is structural: a new line starts a paragraph; punctuation alone does not.
    const startsNewParagraph = /(?:\r\n|\n)[\t ]*$/.test(baseStory)
    const alreadyHasParagraphBreak = /(?:\r\n|\n){2,}[\t ]*$/.test(baseStory)
    const separator = startsNewParagraph && !alreadyHasParagraphBreak ? '\n' : ''
    let generatedText = ''

    try {
      if (draft.autoPickContextOnWrite) {
        status.value = 'Choosing context…'
        try {
          await runContextSelection(controller.signal)
        } catch (cause) {
          // Stopping the write stops this too; any other failure should not block writing.
          if (cause instanceof Error && cause.name === 'AbortError') throw cause
          // The post-write auto-summary clears `error`, so report this where it persists: the
          // note in the Context panel, next to the ticks it is about.
          contextPickNote.value = `Auto-pick failed (${cause instanceof Error ? cause.message : 'unknown error'}); your current ticks were used`
        }
      }
      // The ticks may have just changed, so the lore for this scene is read only now.
      const loreText = sceneLore()
      const context = buildStoryContext({
        lore: loreText,
        chapterSynopsis: activeChapter.value.synopsis,
        prompt: draft.prompt,
        story: baseStory,
        summaries: activeChapter.value.summaries,
        maxTokens: draft.maxTokens,
        numCtx: draft.numCtx,
        writerParagraphs: draft.writerParagraphs,
      })
      context.continueCurrentParagraph = Boolean(baseStory.trim()) && !startsNewParagraph
      let omittedLoreEntries = 0
      if (loreText.trim()) {
        // Summaries establish where the story is now, and the prompt establishes what comes next;
        // together they let this pass select relevant facts without treating old lore as plot.
        // Send every numbered entry, clipping entries evenly only when the selector window needs it.
        status.value = 'Selecting relevant lore…'
        const selectorContext = [
          activeChapter.value.synopsis.trim()
            ? `Current chapter synopsis:\n${activeChapter.value.synopsis.trim()}`
            : '',
          context.summaries ? `Most recent summarized story sections:\n${context.summaries}` : '',
          draft.prompt.trim() ? `Current writing direction:\n${draft.prompt.trim()}` : '',
        ].filter(Boolean).join('\n\n')
        const selectorBudget = loreSelectorBudget(
          draft.numCtx,
          selectorContext.length,
          loreSelectionSystem.length,
        )
        const preparedLore = prepareLoreEntries(loreText, selectorBudget.loreEntriesChars)
        const selectedNumbers = await ollamaClient.chat({
          label: 'Lore selection',
          model: draft.model,
          options: ollamaRequestOptions(draft, {
            temperature: Math.min(draft.temperature, 0.3),
            maxTokens: selectorBudget.outputTokens,
            repeatPenalty: null,
          }),
          format: loreSelectionResponseFormat,
          parse: text => parseLoreSelectionResponse(text, preparedLore.entries),
          signal: controller.signal,
          messages: [
            { role: 'system', content: loreSelectionSystem },
            {
              role: 'user',
              content: `${selectorContext ? `${selectorContext}\n\n` : ''}Numbered lore entries:\n${preparedLore.text}`,
            },
          ],
        })
        const fittedLore = fitLoreEntries(preparedLore.entries, selectedNumbers, context.loreBudget)
        context.lore = fittedLore.text
        omittedLoreEntries = fittedLore.omitted
        if (!context.lore) status.value = 'Writing without relevant lore…'
      }

      if (context.lore) status.value = 'Writing…'
      else if (!loreText.trim()) status.value = 'Writing…'
      const request = makeStoryRequest({
        mode: draft.mode,
        prompt: draft.prompt,
        story: baseStory,
        temperature: draft.temperature,
        maxTokens: draft.maxTokens,
        numCtx: draft.numCtx,
        repeatPenalty: draft.repeatPenalty,
      }, context)
      // Show partial prose as it arrives so the user can monitor or stop generation without
      // waiting for a complete response.
      const appendGeneratedText = (text: string) => {
        generatedText += text
        activeChapter.value.story = baseStory + separator + generatedText
      }
      if (request.kind === 'generate') {
        await ollamaClient.streamGenerate({
          label: 'Write next (continue mode)',
          model: draft.model,
          prompt: request.prompt,
          options: request.options,
          signal: controller.signal,
        }, appendGeneratedText)
      } else {
        await ollamaClient.streamChat({
          label: 'Write next',
          model: draft.model,
          messages: request.messages,
          options: request.options,
          signal: controller.signal,
        }, appendGeneratedText)
      }

      canUndo.value = activeChapter.value.story !== baseStory
      if (generatedText.trim()) {
        status.value = omittedLoreEntries
          ? `Writing complete (${omittedLoreEntries} selected lore entr${omittedLoreEntries === 1 ? 'y did' : 'ies did'} not fit the generation budget)`
          : 'Writing complete'
      }
      if (!generatedText.trim()) status.value = 'The model returned no text.'
    } catch (cause) {
      if (cause instanceof Error && cause.name !== 'AbortError') {
        error.value = cause.message
        status.value = ''
      } else {
        status.value = 'Writing stopped'
      }
      canUndo.value = activeChapter.value.story !== baseStory
    } finally {
      generating.value = false
      abortController.value = null
      scheduleDraftSave()
    }
    if (generatedText.trim()) await summarizeOlderSections(activeChapter.value.story, false)
  }

  function undo() {
    if (!canUndo.value) return
    // Treat one generation or comment application as one user action; undo restores its starting
    // draft instead of exposing internal token-by-token changes.
    activeChapter.value.story = previousStory.value
    activeChapter.value.feedback = previousFeedback.map(comment => ({ ...comment }))
    activeChapter.value.feedbackRevisions = previousFeedbackRevisions
    canUndo.value = false
    status.value = 'Last addition undone'
  }

  function selectChapter(id: string) {
    if (isBusy.value || !draft.chapters.some(chapter => chapter.id === id)) return
    draft.activeChapterId = id
    canUndo.value = false
    status.value = ''
    error.value = ''
  }

  function addChapter() {
    if (isBusy.value) return
    const number = draft.chapters.length + 1
    const chapter: StoryChapter = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: `Chapter ${number}`,
      synopsis: '',
      story: '',
      summaries: [],
      feedback: [],
      feedbackRevisions: [],
    }
    draft.chapters.push(chapter)
    selectChapter(chapter.id)
  }

  function removeChapter(id: string) {
    if (isBusy.value || draft.chapters.length <= 1) return
    const index = draft.chapters.findIndex(chapter => chapter.id === id)
    if (index === -1) return
    draft.chapters.splice(index, 1)
    if (draft.activeChapterId === id) {
      draft.activeChapterId = draft.chapters[Math.min(index, draft.chapters.length - 1)]!.id
    }
    canUndo.value = false
    status.value = 'Chapter removed'
    error.value = ''
  }

  const isBusy = computed(() =>
    generating.value || summarizing.value || revisingFeedback.value || proofreading.value
      || chapterSynopsisBusy.value || loreGenerationBusy.value || selectingContext.value,
  )

  return {
    draft,
    activeChapter,
    contextItems,
    models,
    loadingModels,
    generating,
    error,
    status,
    summarizing,
    revisingFeedback,
    proofreading,
    canUndo,
    previousStory,
    isBusy,
    fixingSynopsis,
    generatingSynopsisId,
    generatingAllStructure,
    generatingLoreId,
    addFeedback,
    applyFeedback,
    proofreadStory,
    removeFeedback: (id: string) => {
      activeChapter.value.feedback = activeChapter.value.feedback.filter(comment => comment.id !== id)
    },
    removeSummary: (id: string) => {
      activeChapter.value.summaries = activeChapter.value.summaries.filter(section => section.id !== id)
    },
    selectedModelSize,
    contextPreview,
    selectChapter,
    addChapter,
    removeChapter,
    fixChapterSynopsis,
    generateChapterSynopsis,
    generateAllChapterStructure,
    generateLoreEntry,
    refreshModels,
    summarizeOlderSections,
    resummarizeAllSections,
    selectingContext,
    contextPickNote,
    canUndoContextPick,
    autoPickContext,
    undoContextPick,
    acceptFix: (id: string) => acceptFixes([id]),
    acceptAllFixes: () => acceptFixes(),
    writeNext,
    undo,
    exportDraft,
    importDraft,
  }
}
