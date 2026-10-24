import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'

export type PromptMode = 'instruct' | 'continue'

export type Draft = {
  lore: string
  story: string
  prompt: string
  model: string
  mode: PromptMode
  temperature: number
  maxTokens: number
  numCtx: number
  repeatPenalty: number
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
  prompt: '',
  model: '',
  mode: 'instruct',
  temperature: 0.8,
  maxTokens: 300,
  numCtx: 4096,
  repeatPenalty: 1.1,
}

export function useStoryWriter() {
  const draft = reactive<Draft>({ ...defaults })
  const models = ref<OllamaModel[]>([])
  const loadingModels = ref(false)
  const generating = ref(false)
  const error = ref('')
  const status = ref('')
  const canUndo = ref(false)
  const previousStory = ref('')
  const abortController = shallowRef<AbortController | null>(null)
  const selectedModelSize = computed(() => models.value.find(model => model.name === draft.model)?.size)
  let readyToSave = false

  onMounted(async () => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) Object.assign(draft, defaults, JSON.parse(saved))
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

  function makeRequest(continueCurrentParagraph: boolean) {
    const options = {
      temperature: draft.temperature,
      num_predict: draft.maxTokens,
      num_ctx: draft.numCtx,
      repeat_penalty: draft.repeatPenalty,
    }
    const system = [
      'You are a fiction co-writer. Continue the story in the same voice and tense.',
      'Write only story text, with no notes, titles, or commentary.',
      continueCurrentParagraph
        ? 'The story ends mid-sentence or mid-paragraph. Continue directly from its final character, completing the current sentence and paragraph before starting a new paragraph.'
        : '',
      draft.lore.trim() ? `Lore and story facts:\n${draft.lore.trim()}` : '',
    ].filter(Boolean).join('\n\n')

    if (draft.mode === 'continue') {
      const context = [
        draft.lore.trim() ? `[Lore]\n${draft.lore.trim()}` : '',
        draft.prompt.trim() ? `[Next prompt: ${draft.prompt.trim()}]` : '',
        continueCurrentParagraph ? '[Continue directly from the unfinished sentence and paragraph.]' : '',
        draft.story.trim() ? `[Story]\n${draft.story}` : '',
      ].filter(Boolean).join('\n\n')
      return {
        url: `${ollamaUrl}/api/generate`,
        body: { model: draft.model, prompt: context, stream: true, options },
        output: (json: { response?: string }) => json.response ?? '',
      }
    }

    const user = [
      draft.story.trim() ? `Story so far:\n${draft.story}` : '',
      draft.prompt.trim()
        ? continueCurrentParagraph
          ? `Continue directly from the unfinished ending, finish the current sentence and paragraph, then follow this direction: ${draft.prompt.trim()}`
          : `Write the next part of the story. What happens next: ${draft.prompt.trim()}`
        : continueCurrentParagraph
          ? 'Continue directly from the unfinished ending and finish the current sentence and paragraph before starting a new paragraph.'
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
    const endsAtLineBreak = /\r?\n$/.test(baseStory)
    const endsAtSentence = /[.!?]["'”’)\]]*\s*$/.test(baseStory)
    const continueCurrentParagraph = Boolean(baseStory.trim()) && !endsAtLineBreak && !endsAtSentence
    const separator = baseStory && !endsAtLineBreak && endsAtSentence ? '\n\n' : ''

    try {
      const request = makeRequest(continueCurrentParagraph)
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
      let generatedText = ''

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
    canUndo,
    selectedModelSize,
    refreshModels,
    writeNext,
    undo,
  }
}
