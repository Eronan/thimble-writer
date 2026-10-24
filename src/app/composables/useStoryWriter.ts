import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { locateSection, paragraphsWithOffsets, planStorySections, type StorySectionSummary } from '~/utils/storySections'
import { locateFeedback, type StoryFeedback } from '~/utils/storyFeedback'
import { ollamaClient, ollamaRequestOptions, type OllamaModel } from '~/clients/ollamaClient'

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

const storageKey = 'thimble-writer-v1'
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

const summarySystem = 'Summarize this story section in one or two concise sentences, in past tense. Name the characters and preserve important events and changes. Reply with only the summary.'
const summaryReplyTokens = 120
const charsPerToken = 3.5
const summaryReplyReserve = 180

export function useStoryWriter() {
  const draft = reactive<Draft>({ ...defaults })
  const models = ref<OllamaModel[]>([])
  const loadingModels = ref(false)
  const generating = ref(false)
  const error = ref('')
  const status = ref('')
  const summarizing = ref(false)
  const revisingFeedback = ref(false)
  const canUndo = ref(false)
  const previousStory = ref('')
  let previousFeedbackRevisions: FeedbackRevision[] = []
  const abortController = shallowRef<AbortController | null>(null)
  const selectedModelSize = computed(() => models.value.find(model => model.name === draft.model)?.size)
  let readyToSave = false

  onMounted(async () => {
    try {
      const saved = localStorage.getItem(storageKey)
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

  watch(draft, (value) => {
    if (!readyToSave) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      error.value = 'Could not save this draft in browser storage.'
    }
  }, { deep: true })

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

  function buildContext() {
    // Bound every prompt by the configured context window so generation has room to finish;
    // otherwise a long draft can crowd out the requested continuation or exceed the model limit.
    const inputTokens = Math.max(0, draft.numCtx - draft.maxTokens - summaryReplyReserve)
    let remainingChars = Math.max(0, Math.floor(inputTokens * charsPerToken))
    const lore = draft.lore.trim()
    const prompt = draft.prompt.trim()
    const paragraphs = paragraphsWithOffsets(draft.story)
    const recentParagraphCount = Math.max(1, Math.floor(draft.writerParagraphs) || defaults.writerParagraphs)
    const recentStart = paragraphs.at(-recentParagraphCount)?.start ?? draft.story.length
    const validSummaries = draft.summaries
      .map(section => ({ section, range: locateSection(draft.story, section) }))
      // A stale/overlapping summary must not hide the recent scene: the model needs its exact
      // wording to continue naturally, while summaries are intended only for older material.
      .filter(entry => entry.section.summary.trim() && entry.range && entry.range.end <= recentStart)
    const uncompressedParagraphs = paragraphs.filter(paragraph =>
      !validSummaries.some(({ range }) => range && paragraph.start < range.end && paragraph.end > range.start),
    )
    const uncompressedTextLength = uncompressedParagraphs.reduce((length, paragraph) => length + paragraph.text.length + 2, 0)
    const fixedChars = prompt.length + summarySystem.length + 180
    remainingChars = Math.max(0, remainingChars - fixedChars)
    const storyBudget = Math.min(uncompressedTextLength, Math.floor(remainingChars * 0.6))
    let storyTail = ''
    let usedStoryChars = 0
    // Favor the immediate lead-in over distant prose. Keep paragraph boundaries intact where
    // possible so the model sees readable prose rather than a fragment stitched across scenes.
    for (let index = uncompressedParagraphs.length - 1; index >= 0; index--) {
      const entry = uncompressedParagraphs[index]
      if (!entry) continue
      const paragraph = entry.text
      const additionalChars = paragraph.length + (storyTail ? 2 : 0)
      if (usedStoryChars + additionalChars <= storyBudget) {
        storyTail = storyTail ? `${paragraph}\n\n${storyTail}` : paragraph
        usedStoryChars += additionalChars
        continue
      }
      if (!storyTail && storyBudget > 0) {
        storyTail = paragraph.slice(-storyBudget)
        usedStoryChars = storyTail.length
      }
      break
    }
    remainingChars -= usedStoryChars

    // Reserve space for summaries and cap lore before the selection pass. Smaller, relevant lore
    // gives lower-parameter models useful world facts without asking them to carry the full bible.
    const loreBudget = Math.floor(remainingChars * 0.45)
    const loreContext = lore.slice(0, loreBudget)
    remainingChars -= loreContext.length

    // Summaries help the model remember older events, but stay distinct from canonical story text
    // so a compressed retelling is never mistaken for prose to continue or alter.
    // Plain labels are deliberate: prompts are consumed as text, so XML would add syntax without
    // giving the app any structured output to validate or parse.
    const summaryBudget = remainingChars
    const selectedSummaries: string[] = []
    let usedSummaryChars = 0
    for (const { section } of [...validSummaries].reverse()) {
      const line = `- ${section.summary.trim()}`
      if (!section.summary.trim()) continue
      if (usedSummaryChars + line.length > summaryBudget) break
      selectedSummaries.unshift(line)
      usedSummaryChars += line.length
    }

    return {
      lore: loreContext,
      summaries: selectedSummaries.join('\n'),
      story: storyTail,
      continueCurrentParagraph: Boolean(draft.story.trim())
        && !/(?:\r\n|\n)[\t ]*$/.test(draft.story),
    }
  }

  function makeRequest(context: ReturnType<typeof buildContext>) {
    const options = ollamaRequestOptions(draft)
    const system = [
      'You are a fiction co-writer. Continue the story in the same voice and tense.',
      'Write only story text, with no notes, titles, or commentary.',
      context.continueCurrentParagraph
        ? 'Continue directly from the story’s final character and remain in the current paragraph. Do not start a new paragraph.'
        : '',
      context.lore ? `Lore and story facts:\n${context.lore}` : '',
      context.summaries ? `Story so far (section summaries):\n${context.summaries}` : '',
    ].filter(Boolean).join('\n\n')

    if (draft.mode === 'continue') {
      // Raw mode is explicitly a single completion prompt; adding chat-style role framing would
      // change the behavior users selected for direct continuation.
      const rawPrompt = [
        context.lore ? `[Lore]\n${context.lore}` : '',
        context.summaries ? `[Story memory]\n${context.summaries}` : '',
        draft.prompt.trim() ? `[Next prompt: ${draft.prompt.trim()}]` : '',
        context.continueCurrentParagraph ? '[Continue on the same line and in the same paragraph.]' : '',
        context.story ? `[Story text kept verbatim]\n${context.story}` : '',
      ].filter(Boolean).join('\n\n')
      return {
        kind: 'generate' as const,
        prompt: rawPrompt,
        options,
      }
    }

    const user = [
      context.story ? `Story text kept verbatim:\n${context.story}` : '',
      draft.prompt.trim()
        ? context.continueCurrentParagraph
          ? `Continue directly from the final character and stay in the same paragraph, then follow this direction: ${draft.prompt.trim()}`
          : `Write the next part of the story. What happens next: ${draft.prompt.trim()}`
        : context.continueCurrentParagraph
          ? 'Continue directly from the final character and stay in the same paragraph.'
        : draft.story.trim()
          ? 'Continue the story with the next paragraph.'
          : 'Write the opening paragraph of the story.',
    ].filter(Boolean).join('\n\n')

    return {
      kind: 'chat' as const,
      options,
      messages: [{ role: 'system' as const, content: system }, { role: 'user' as const, content: user }],
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
        const surroundingText = draft.story.slice(contextStart, contextEnd)
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
        const user = [
          draft.lore.trim() ? `Lore:\n${draft.lore.trim()}` : '',
          sectionSummaries.length ? `Relevant section summaries:\n${sectionSummaries.join('\n')}` : '',
          `Surrounding story context (do not replace this entire context):\n${surroundingText}`,
          `Selected passage to replace:\n${comment.source}`,
          `Feedback for this passage:\n${comment.instruction}`,
        ].filter(Boolean).join('\n\n')
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
    previousFeedbackRevisions = [...draft.feedbackRevisions]
    canUndo.value = false
    // The user's rule is structural: a new line starts a paragraph; punctuation alone does not.
    const startsNewParagraph = /(?:\r\n|\n)[\t ]*$/.test(baseStory)
    const alreadyHasParagraphBreak = /(?:\r\n|\n){2,}[\t ]*$/.test(baseStory)
    const context = buildContext()
    context.continueCurrentParagraph = Boolean(baseStory.trim()) && !startsNewParagraph
    const separator = startsNewParagraph && !alreadyHasParagraphBreak ? '\n' : ''
    let generatedText = ''

    try {
      if (context.lore) {
        // Summaries establish where the story is now, and the prompt establishes what comes next;
        // together they let this pass select relevant facts without treating old lore as plot.
        // Only lore facts go into generation so the story remains the source of narrative events.
        status.value = 'Selecting relevant lore…'
        context.lore = (await ollamaClient.chat({
          model: draft.model,
          options: ollamaRequestOptions(draft, {
            temperature: Math.min(draft.temperature, 0.3),
            maxTokens: Math.min(draft.maxTokens, 400),
            repeatPenalty: null,
          }),
          signal: controller.signal,
          messages: [
            {
              role: 'system',
              content: [
                'You prepare concise, relevant lore for a fiction co-writer.',
                'Use the lore as the source of truth. Use the recent section summaries only to determine which lore is relevant to the current point in the story.',
                'Return only the relevant established facts, names, relationships, constraints, and unresolved details. Do not repeat story events from the summaries, invent facts, or add prose.',
                'If no lore is relevant, reply with an empty response.',
              ].join(' '),
            },
            {
              role: 'user',
              content: [
                `Lore:\n${context.lore}`,
                context.summaries ? `Most recent summarized story sections:\n${context.summaries}` : '',
                draft.prompt.trim() ? `Current writing direction:\n${draft.prompt.trim()}` : '',
                'Relevant lore:',
              ].filter(Boolean).join('\n\n'),
            },
          ],
        })).trim()
        if (!context.lore) status.value = 'Writing without relevant lore…'
      }

      if (context.lore) status.value = 'Writing…'
      else if (!draft.lore.trim()) status.value = 'Writing…'
      const request = makeRequest(context)
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
      if (generatedText.trim()) status.value = 'Writing complete'
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
    }
    if (generatedText.trim()) await summarizeOlderSections(draft.story, false)
  }

  function undo() {
    if (!canUndo.value) return
    // Treat one generation or comment application as one user action; undo restores its starting
    // draft instead of exposing internal token-by-token changes.
    draft.story = previousStory.value
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
    canUndo,
    addFeedback,
    applyFeedback,
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
