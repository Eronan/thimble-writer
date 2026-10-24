import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { locateSection, paragraphsWithOffsets, planStorySections, type StorySectionSummary } from '~/utils/storySections'
import { locateFeedback, type StoryFeedback } from '~/utils/storyFeedback'
import { ollamaClient, ollamaRequestOptions, type OllamaModel } from '~/clients/ollamaClient'
import { draftStorage } from '~/clients/draftStorage'
import { buildStoryContext, charsPerToken, makeStoryRequest, summaryReplyTokens, summarySystem } from '~/utils/storyPrompt'
import { buildFeedbackRevisionContext } from '~/utils/feedbackRevisionPrompt'
import {
  fitLoreEntries,
  loreSelectionResponseFormat,
  loreSelectionSystem,
  parseLoreSelectionResponse,
  prepareLoreEntries,
} from '~/utils/storyLore'
import {
  anchorProofreadSuggestions,
  parseProofreadResponse,
  proofreadResponseFormat,
  splitStoryForProofreading,
  type AnchoredProofreadSuggestion,
} from '~/utils/storyProofread'

export type PromptMode = 'instruct' | 'continue'

export type Draft = {
  lore: string
  story: string
  summaries: StorySectionSummary[]
  feedback: StoryFeedback[]
  feedbackRevisions: FeedbackRevision[]
  prompt: string
  model: string
  mode: PromptMode
  temperature: number
  maxTokens: number
  numCtx: number
  repeatPenalty: number
  writerParagraphs: number
  sectionParagraphs: number
}

export type FeedbackRevision = {
  id: string
  instruction: string
  before: string
  after: string
  appliedAt: number
}

const draftSaveDelay = 500
// The continuation should see the actual recent wording for voice and immediate continuity;
// summaries are a memory aid for older events, not a replacement for the current scene.
const defaults: Draft = {
  lore: '',
  story: '',
  summaries: [],
  feedback: [],
  feedbackRevisions: [],
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
  const models = ref<OllamaModel[]>([])
  const loadingModels = ref(false)
  const generating = ref(false)
  const error = ref('')
  const status = ref('')
  const summarizing = ref(false)
  const revisingFeedback = ref(false)
  const proofreading = ref(false)
  const canUndo = ref(false)
  const previousStory = ref('')
  let previousFeedback: StoryFeedback[] = []
  let previousFeedbackRevisions: FeedbackRevision[] = []
  const abortController = shallowRef<AbortController | null>(null)
  const selectedModelSize = computed(() => models.value.find(model => model.name === draft.model)?.size)
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

  onMounted(async () => {
    window.addEventListener('pagehide', persistDraft)
    try {
      const saved = await draftStorage.load()
      if (saved) {
        const parsed = JSON.parse(saved)
        Object.assign(draft, defaults, parsed)
        // Validate collections separately so older browser drafts can be upgraded safely.
        draft.summaries = Array.isArray(parsed.summaries)
          ? parsed.summaries.filter((section: StorySectionSummary) =>
              typeof section?.id === 'string'
              && typeof section?.source === 'string'
              && typeof section?.summary === 'string',
            )
          : []
        draft.feedback = Array.isArray(parsed.feedback)
          ? parsed.feedback.filter((comment: StoryFeedback) =>
              typeof comment?.id === 'string'
              && typeof comment?.source === 'string'
              && typeof comment?.instruction === 'string'
              && Number.isInteger(comment?.start),
            )
          : []
        draft.feedbackRevisions = Array.isArray(parsed.feedbackRevisions)
            ? parsed.feedbackRevisions.filter((revision: FeedbackRevision) =>
                typeof revision?.id === 'string'
                && typeof revision?.instruction === 'string'
                && typeof revision?.before === 'string'
                && typeof revision?.after === 'string'
                && Number.isFinite(revision?.appliedAt),
              )
            : []
      }
    } catch {
      error.value = 'Could not load the saved draft from this browser.'
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

  async function summarizeOlderSections(story = draft.story, flush = true) {
    if (summarizing.value || generating.value) return
    if (!draft.model) {
      error.value = 'Choose an Ollama model before summarizing story sections.'
      return
    }
    summarizing.value = true
    error.value = ''
    try {
      const sourceBudget = Math.max(300, Math.floor((draft.numCtx - summaryReplyTokens - 200) * charsPerToken))
      const sources = planStorySections(
        story,
        draft.summaries,
        Math.max(1, Math.floor(draft.writerParagraphs) || defaults.writerParagraphs),
        Math.max(1, Math.floor(draft.sectionParagraphs) || defaults.sectionParagraphs),
        flush,
        sourceBudget,
      )
      // Automatic summaries wait for completed sections to avoid compressing the active scene.
      // Manual summarizing flushes eligible prose because an explicit user action means "do it now".
      if (!sources.length) {
        if (flush) status.value = 'No older sections need summarizing yet'
        return
      }
      status.value = 'Summarizing older story sections…'
      let added = 0
      for (const source of sources) {
        if (source.length > sourceBudget) {
          throw new Error('A paragraph is longer than the summarizer context budget. Increase the context size or split that paragraph.')
        }
        const response = await ollamaClient.chat({
          model: draft.model,
          options: ollamaRequestOptions(draft, {
            temperature: 0.3,
            maxTokens: summaryReplyTokens,
            repeatPenalty: null,
          }),
          messages: [
            { role: 'system', content: summarySystem },
            { role: 'user', content: `Story section:\n${source}\n\nSummary:` },
          ],
        })
        const summary = response.replace(/\s+/g, ' ').trim()
        if (!summary) throw new Error('Ollama returned an empty section summary.')
        draft.summaries.push({
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          source,
          summary,
        })
        added++
      }
      status.value = added ? `Summarized ${added} older section${added === 1 ? '' : 's'}` : 'No older sections need summarizing yet'
    } catch (cause) {
      error.value = cause instanceof Error ? `Summary failed: ${cause.message}` : 'Summary failed.'
      status.value = ''
    } finally {
      summarizing.value = false
    }
  }

  function addFeedback(selection: { start: number; end: number; text: string }, instruction: string) {
    const { start, end, text } = selection
    if (start < 0 || end <= start || end > draft.story.length || draft.story.slice(start, end) !== text) {
      error.value = 'Select text that is still present in the story before adding feedback.'
      return false
    }
    if (!instruction.trim()) {
      error.value = 'Write a feedback instruction for the selected text.'
      return false
    }
    // Feedback is scoped to the exact selection. Reject overlaps so one queued rewrite cannot
    // silently consume or reshape the passage another comment is meant to address.
    const overlaps = draft.feedback.some((comment) => {
      const range = locateFeedback(draft.story, comment)
      return range && start < range.end && end > range.start
    })
    if (overlaps) {
      error.value = 'That selection overlaps an existing feedback comment. Remove or revise the existing comment first.'
      return false
    }
    draft.feedback.push({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      start,
      source: text,
      before: draft.story.slice(Math.max(0, start - 80), start),
      after: draft.story.slice(end, end + 80),
      instruction: instruction.trim(),
    })
    error.value = ''
    status.value = 'Feedback added to the queue'
    return true
  }

  async function applyFeedback(commentId?: string) {
    const comments = commentId
      ? draft.feedback.filter(comment => comment.id === commentId)
      : [...draft.feedback]
    if (revisingFeedback.value || generating.value || summarizing.value || !comments.length) return
    if (!draft.model) {
      error.value = 'Choose an Ollama model before applying feedback.'
      return
    }

    revisingFeedback.value = true
    error.value = ''
    status.value = commentId ? 'Applying comment…' : 'Applying feedback…'
    previousStory.value = draft.story
    previousFeedback = draft.feedback.map(comment => ({ ...comment }))
    previousFeedbackRevisions = [...draft.feedbackRevisions]
    canUndo.value = false
    let applied = 0
    try {
      // Apply comments in queue order, but re-locate each target against the latest draft because
      // replacing earlier text shifts offsets. Disjoint selections keep each instruction scoped.
      for (const comment of comments) {
        const range = locateFeedback(draft.story, comment)
        if (!range) {
          throw new Error(`Could not find the selected passage for feedback: “${comment.source.slice(0, 70)}”`)
        }

        const paragraphs = paragraphsWithOffsets(draft.story)
        const firstParagraph = paragraphs.findIndex(paragraph => paragraph.start <= range.start && paragraph.end >= range.start)
        const lastParagraph = paragraphs.findIndex(paragraph => paragraph.start < range.end && paragraph.end >= range.end)
        const contextStart = paragraphs[Math.max(0, firstParagraph - 1)]?.start ?? range.start
        const contextEnd = paragraphs[Math.min(paragraphs.length - 1, Math.max(lastParagraph, 0) + 1)]?.end ?? range.end
        const sectionSummaries = draft.summaries
          .map(section => ({ section, range: locateSection(draft.story, section) }))
          .filter(item => item.range && item.range.start <= range.end && item.range.end >= range.start)
          .map(item => item.section.summary.trim())
          .filter(Boolean)
        const system = [
          'You are a fiction editor revising a specific passage in a story.',
          'Apply the feedback only to the selected passage. Return only the replacement passage, with no explanation, labels, or quotation marks.',
          'Preserve the surrounding context, point of view, tense, and voice. Do not rewrite or repeat text outside the selected passage.',
        ].join('\n')
        const user = buildFeedbackRevisionContext({
          system,
          lore: draft.lore,
          summaries: sectionSummaries,
          surroundingBefore: draft.story.slice(contextStart, range.start),
          surroundingAfter: draft.story.slice(range.end, contextEnd),
          selectedPassage: comment.source,
          instruction: comment.instruction,
          maxChars: Math.floor((draft.numCtx - draft.maxTokens - 250) * charsPerToken),
        })
        const response = await ollamaClient.chat({
          model: draft.model,
          options: ollamaRequestOptions(draft, { temperature: Math.min(draft.temperature, 0.5) }),
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        })
        const replacement = response.trim()
        if (!replacement) throw new Error('Ollama returned an empty passage revision.')

        // The model may read surrounding prose for continuity, but only the user's selected range
        // is replaced so applying feedback cannot unexpectedly rewrite neighboring paragraphs.
        draft.story = `${draft.story.slice(0, range.start)}${replacement}${draft.story.slice(range.end)}`
        draft.feedbackRevisions.push({
          id: `${comment.id}-${Date.now().toString(36)}`,
          instruction: comment.instruction,
          before: comment.source,
          after: replacement,
          appliedAt: Date.now(),
        })
        draft.feedback = draft.feedback.filter(item => item.id !== comment.id)
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
      canUndo.value = draft.story !== previousStory.value
        || draft.feedback.length !== previousFeedback.length
        || draft.feedbackRevisions.length !== previousFeedbackRevisions.length
    }
  }

  async function proofreadStory() {
    if (proofreading.value || generating.value || summarizing.value || revisingFeedback.value) return
    if (!draft.model) {
      error.value = 'Choose an Ollama model before proofreading.'
      return
    }
    if (!draft.story.trim()) {
      status.value = 'Write some story text before proofreading.'
      return
    }
    const proofreadMaxTokens = Math.min(Math.max(draft.maxTokens, 1200), Math.max(1, draft.numCtx - 256))
    const availableInputChars = Math.floor((draft.numCtx - proofreadMaxTokens - 300) * charsPerToken)
    if (availableInputChars < 1) {
      error.value = 'The context size is too small for proofreading with the current output limit.'
      return
    }
    const chunkBudget = Math.min(2000, availableInputChars)

    proofreading.value = true
    error.value = ''
    status.value = 'Preparing story for proofreading…'
    try {
      const storySnapshot = draft.story
      const chunks = splitStoryForProofreading(storySnapshot, chunkBudget, draft.summaries)
      const suggestions: AnchoredProofreadSuggestion[] = []
      let skipped = 0
      let truncatedResponses = 0
      for (const [index, chunk] of chunks.entries()) {
        status.value = chunks.length > 1
          ? `Proofreading section ${index + 1} of ${chunks.length}…`
          : 'Proofreading story…'
        const response = await ollamaClient.chat({
          model: draft.model,
          options: ollamaRequestOptions(draft, {
            temperature: Math.min(draft.temperature, 0.2),
            maxTokens: proofreadMaxTokens,
            repeatPenalty: null,
          }),
          format: proofreadResponseFormat,
          messages: [
            {
              role: 'system',
              content: [
                'You are a careful fiction proofreader. Identify only clear spelling, grammar, punctuation, or wording errors; do not rewrite for subjective style preferences.',
                'Return a structured comments list. Each quote must be an exact, contiguous passage from the story and should be as short as possible while identifying the issue.',
                'The before and after fields must be exact adjacent text immediately before and after the quote, each no longer than 80 characters. Use them to disambiguate repeated quotes.',
                'The story summaries are context only. Do not proofread them or return comments about them.',
                'Return at most three comments for this passage. Focus on the clearest, most important errors.',
                'Keep issue and suggestion brief, with a suggested correction of no more than 20 words. Do not change the story yourself.',
              ].join(' '),
            },
            {
              role: 'user',
              content: [
                chunk.summaries.length
                  ? `Relevant story summaries (context only):\n${chunk.summaries.map(summary => `- ${summary}`).join('\n')}`
                  : '',
                `Proofread only this story passage:\n\n${chunk.text}`,
              ].filter(Boolean).join('\n\n'),
            },
          ],
        })
        const parsed = parseProofreadResponse(response)
        if (parsed.incomplete) truncatedResponses++
        const anchored = anchorProofreadSuggestions(chunk, parsed.comments)
        suggestions.push(...anchored.comments)
        skipped += anchored.skipped
      }

      const occupied = draft.feedback
        .map(comment => locateFeedback(storySnapshot, comment))
        .filter((range): range is NonNullable<typeof range> => range !== null)
      if (draft.story !== storySnapshot) {
        throw new Error('The story changed during proofreading. No comments were added; run proofreading again.')
      }
      let added = 0
      for (const suggestion of suggestions) {
        const overlaps = occupied.some(range => suggestion.start < range.end && suggestion.end > range.start)
        if (overlaps) {
          skipped++
          continue
        }
        const comment: StoryFeedback = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          start: suggestion.start,
          source: suggestion.quote,
          before: storySnapshot.slice(Math.max(0, suggestion.start - 80), suggestion.start),
          after: storySnapshot.slice(suggestion.end, suggestion.end + 80),
          instruction: `${suggestion.issue} Suggested correction: ${suggestion.suggestion}`,
        }
        // Proofreading proposes edits as reviewable comments so the writer stays in control of
        // which changes, if any, are applied to the canonical story.
        draft.feedback.push(comment)
        occupied.push({ start: suggestion.start, end: suggestion.end })
        added++
      }
      const incompleteNotice = truncatedResponses
        ? `; recovered complete comments from ${truncatedResponses} truncated response${truncatedResponses === 1 ? '' : 's'}`
        : ''
      status.value = added
        ? `Proofreading added ${added} comment${added === 1 ? '' : 's'}${skipped ? `; skipped ${skipped} unanchored or overlapping suggestion${skipped === 1 ? '' : 's'}` : ''}${incompleteNotice}`
        : skipped
          ? `No comments added; skipped ${skipped} suggestion${skipped === 1 ? '' : 's'} that could not be safely anchored${incompleteNotice}`
          : truncatedResponses
            ? `Proofreading response was truncated and contained no complete comments${incompleteNotice}`
            : 'Proofreading found no clear issues'
    } catch (cause) {
      error.value = cause instanceof Error ? `Proofreading failed: ${cause.message}` : 'Proofreading failed.'
      status.value = ''
    } finally {
      proofreading.value = false
    }
  }

  async function writeNext() {
    if (generating.value) {
      abortController.value?.abort()
      return
    }
    if (!draft.model) {
      error.value = 'Choose an Ollama model before writing.'
      return
    }

    error.value = ''
    status.value = 'Writing…'
    generating.value = true
    const controller = new AbortController()
    abortController.value = controller
    const baseStory = draft.story
    previousStory.value = baseStory
    previousFeedback = draft.feedback.map(comment => ({ ...comment }))
    previousFeedbackRevisions = [...draft.feedbackRevisions]
    canUndo.value = false
    // The user's rule is structural: a new line starts a paragraph; punctuation alone does not.
    const startsNewParagraph = /(?:\r\n|\n)[\t ]*$/.test(baseStory)
    const alreadyHasParagraphBreak = /(?:\r\n|\n){2,}[\t ]*$/.test(baseStory)
    const context = buildStoryContext({
      lore: draft.lore,
      prompt: draft.prompt,
      story: baseStory,
      summaries: draft.summaries,
      maxTokens: draft.maxTokens,
      numCtx: draft.numCtx,
      writerParagraphs: draft.writerParagraphs,
    })
    context.continueCurrentParagraph = Boolean(baseStory.trim()) && !startsNewParagraph
    const separator = startsNewParagraph && !alreadyHasParagraphBreak ? '\n' : ''
    let generatedText = ''

    try {
      let omittedLoreEntries = 0
      if (draft.lore.trim()) {
        // Summaries establish where the story is now, and the prompt establishes what comes next;
        // together they let this pass select relevant facts without treating old lore as plot.
        // Send every numbered entry, clipping entries evenly only when the selector window needs it.
        status.value = 'Selecting relevant lore…'
        const selectorMaxTokens = Math.min(256, Math.max(1, draft.numCtx - 300))
        const selectorInputBudget = Math.floor((draft.numCtx - selectorMaxTokens - 200) * charsPerToken)
        const selectorContext = [
          context.summaries ? `Most recent summarized story sections:\n${context.summaries}` : '',
          draft.prompt.trim() ? `Current writing direction:\n${draft.prompt.trim()}` : '',
        ].filter(Boolean).join('\n\n')
        const loreInputBudget = selectorInputBudget - loreSelectionSystem.length - selectorContext.length - 180
        const preparedLore = prepareLoreEntries(draft.lore, loreInputBudget)
        const selectionResponse = await ollamaClient.chat({
          model: draft.model,
          options: ollamaRequestOptions(draft, {
            temperature: Math.min(draft.temperature, 0.3),
            maxTokens: selectorMaxTokens,
            repeatPenalty: null,
          }),
          format: loreSelectionResponseFormat,
          signal: controller.signal,
          messages: [
            { role: 'system', content: loreSelectionSystem },
            {
              role: 'user',
              content: `${selectorContext ? `${selectorContext}\n\n` : ''}Numbered lore entries:\n${preparedLore.text}`,
            },
          ],
        })
        const selectedNumbers = parseLoreSelectionResponse(selectionResponse, preparedLore.entries)
        const fittedLore = fitLoreEntries(preparedLore.entries, selectedNumbers, context.loreBudget)
        context.lore = fittedLore.text
        omittedLoreEntries = fittedLore.omitted
        if (!context.lore) status.value = 'Writing without relevant lore…'
      }

      if (context.lore) status.value = 'Writing…'
      else if (!draft.lore.trim()) status.value = 'Writing…'
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
        draft.story = baseStory + separator + generatedText
      }
      if (request.kind === 'generate') {
        await ollamaClient.streamGenerate({
          model: draft.model,
          prompt: request.prompt,
          options: request.options,
          signal: controller.signal,
        }, appendGeneratedText)
      } else {
        await ollamaClient.streamChat({
          model: draft.model,
          messages: request.messages,
          options: request.options,
          signal: controller.signal,
        }, appendGeneratedText)
      }

      canUndo.value = draft.story !== baseStory
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
      canUndo.value = draft.story !== baseStory
    } finally {
      generating.value = false
      abortController.value = null
      scheduleDraftSave()
    }
    if (generatedText.trim()) await summarizeOlderSections(draft.story, false)
  }

  function undo() {
    if (!canUndo.value) return
    // Treat one generation or comment application as one user action; undo restores its starting
    // draft instead of exposing internal token-by-token changes.
    draft.story = previousStory.value
    draft.feedback = previousFeedback.map(comment => ({ ...comment }))
    draft.feedbackRevisions = previousFeedbackRevisions
    canUndo.value = false
    status.value = 'Last addition undone'
  }

  return {
    draft,
    models,
    loadingModels,
    generating,
    error,
    status,
    summarizing,
    revisingFeedback,
    proofreading,
    canUndo,
    addFeedback,
    applyFeedback,
    proofreadStory,
    removeFeedback: (id: string) => {
      draft.feedback = draft.feedback.filter(comment => comment.id !== id)
    },
    removeSummary: (id: string) => {
      draft.summaries = draft.summaries.filter(section => section.id !== id)
    },
    selectedModelSize,
    refreshModels,
    summarizeOlderSections,
    writeNext,
    undo,
  }
}
