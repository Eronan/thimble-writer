import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { locateSection, paragraphsWithOffsets, planStorySections, type StorySectionSummary } from '~/utils/storySections'

export type PromptMode = 'instruct' | 'continue'

export type Draft = {
  lore: string
  story: string
  summaries: StorySectionSummary[]
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

export type OllamaModel = {
  name: string
  size?: number
}

const ollamaUrl = 'http://localhost:11434'
const storageKey = 'thimble-writer-v1'
const defaults: Draft = {
  lore: '',
  story: '',
  summaries: [],
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
  const canUndo = ref(false)
  const previousStory = ref('')
  const abortController = shallowRef<AbortController | null>(null)
  const selectedModelSize = computed(() => models.value.find(model => model.name === draft.model)?.size)
  let readyToSave = false

  onMounted(async () => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        Object.assign(draft, defaults, parsed)
        draft.summaries = Array.isArray(parsed.summaries)
          ? parsed.summaries.filter((section: StorySectionSummary) =>
              typeof section?.id === 'string'
              && typeof section?.source === 'string'
              && typeof section?.summary === 'string',
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
      const response = await fetch(`${ollamaUrl}/api/tags`)
      if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`)
      const data = await response.json()
      models.value = (data.models ?? []).map((model: { name: string; size?: number }) => ({
        name: model.name,
        size: model.size,
      }))
      if (!models.value.some(model => model.name === draft.model)) {
        draft.model = models.value[0]?.name ?? ''
      }
      if (!models.value.length) status.value = 'No Ollama models found. Pull a model, then refresh.'
      else status.value = `${models.value.length} model${models.value.length === 1 ? '' : 's'} available`
    } catch {
      error.value = `Can't reach Ollama at ${ollamaUrl}. Start Ollama and allow this app's origin with OLLAMA_ORIGINS.`
      status.value = ''
    } finally {
      loadingModels.value = false
    }
  }

  function buildContext() {
    const inputTokens = Math.max(0, draft.numCtx - draft.maxTokens - summaryReplyReserve)
    let remainingChars = Math.max(0, Math.floor(inputTokens * charsPerToken))
    const lore = draft.lore.trim()
    const prompt = draft.prompt.trim()
    const paragraphs = paragraphsWithOffsets(draft.story)
    const recentParagraphCount = Math.max(1, Math.floor(draft.writerParagraphs) || defaults.writerParagraphs)
    const recentStart = paragraphs.at(-recentParagraphCount)?.start ?? draft.story.length
    const validSummaries = draft.summaries
      .map(section => ({ section, range: locateSection(draft.story, section) }))
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

    const loreBudget = Math.floor(remainingChars * 0.45)
    const loreContext = lore.slice(0, loreBudget)
    remainingChars -= loreContext.length

    // Keep canonical story text and its summaries in separate labeled blocks. Plain labels are
    // intentional: they provide structure without introducing a brittle XML parsing convention.
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
    const options = {
      temperature: draft.temperature,
      num_predict: draft.maxTokens,
      num_ctx: draft.numCtx,
      repeat_penalty: draft.repeatPenalty,
    }
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
      const rawPrompt = [
        context.lore ? `[Lore]\n${context.lore}` : '',
        context.summaries ? `[Story memory]\n${context.summaries}` : '',
        draft.prompt.trim() ? `[Next prompt: ${draft.prompt.trim()}]` : '',
        context.continueCurrentParagraph ? '[Continue on the same line and in the same paragraph.]' : '',
        context.story ? `[Story text kept verbatim]\n${context.story}` : '',
      ].filter(Boolean).join('\n\n')
      return {
        url: `${ollamaUrl}/api/generate`,
        body: { model: draft.model, prompt: rawPrompt, stream: true, options },
        output: (json: { response?: string }) => json.response ?? '',
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
      url: `${ollamaUrl}/api/chat`,
      body: {
        model: draft.model,
        stream: true,
        options,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      },
      output: (json: { message?: { content?: string } }) => json.message?.content ?? '',
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
        const response = await fetch(`${ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: draft.model,
            stream: false,
            options: { temperature: 0.3, num_predict: summaryReplyTokens, num_ctx: draft.numCtx },
            messages: [
              { role: 'system', content: summarySystem },
              { role: 'user', content: `Story section:\n${source}\n\nSummary:` },
            ],
          }),
        })
        if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`)
        const data = await response.json()
        const summary = (data.message?.content ?? '').replace(/\s+/g, ' ').trim()
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
    canUndo.value = false
    // A newline, not sentence punctuation, is the explicit signal to start a new paragraph.
    const startsNewParagraph = /(?:\r\n|\n)[\t ]*$/.test(baseStory)
    const alreadyHasParagraphBreak = /(?:\r\n|\n){2,}[\t ]*$/.test(baseStory)
    const context = buildContext()
    context.continueCurrentParagraph = Boolean(baseStory.trim()) && !startsNewParagraph
    const separator = startsNewParagraph && !alreadyHasParagraphBreak ? '\n' : ''
    let generatedText = ''

    try {
      const request = makeRequest(context)
      const response = await fetch(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`)
      if (!response.body) throw new Error('Ollama did not return a response stream.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const consumeLine = (line: string) => {
        if (!line.trim()) return
        const json = JSON.parse(line)
        if (json.error) throw new Error(json.error)
        generatedText += request.output(json)
        draft.story = baseStory + separator + generatedText
        if (json.done) status.value = 'Writing complete'
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) consumeLine(line)
      }
      buffer += decoder.decode()
      if (buffer.trim()) consumeLine(buffer)

      canUndo.value = draft.story !== baseStory
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
    draft.story = previousStory.value
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
    canUndo,
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
