import { appendDebugResponse, finishDebugEntry, startDebugEntry } from './debugLog.ts'

export type OllamaModel = {
  name: string
  size?: number
}

export type OllamaSettings = {
  temperature: number
  maxTokens: number
  numCtx: number
  repeatPenalty: number
}

export type OllamaRequestOptions = {
  temperature: number
  num_predict: number
  num_ctx: number
  repeat_penalty?: number
}

export type OllamaChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function ollamaRequestOptions(
  settings: OllamaSettings,
  overrides: Omit<Partial<OllamaSettings>, 'repeatPenalty'> & { repeatPenalty?: number | null } = {},
): OllamaRequestOptions {
  const options: OllamaRequestOptions = {
    temperature: overrides.temperature ?? settings.temperature,
    num_predict: overrides.maxTokens ?? settings.maxTokens,
    num_ctx: settings.numCtx,
  }
  // Keep normal writing and feedback consistent with the user's settings. Short summary/selection
  // passes opt out of repeat penalty because their job is to condense/select, not continue prose.
  const repeatPenalty = overrides.repeatPenalty === null
    ? undefined
    : overrides.repeatPenalty ?? settings.repeatPenalty
  if (repeatPenalty !== undefined) options.repeat_penalty = repeatPenalty
  return options
}

type ChatRequest = {
  model: string
  messages: OllamaChatMessage[]
  options: OllamaRequestOptions
  format?: 'json' | Record<string, unknown>
  signal?: AbortSignal
  /** Names this request in the Developer tab. */
  label?: string
}

type GenerateRequest = {
  model: string
  prompt: string
  options: OllamaRequestOptions
  signal?: AbortSignal
  label?: string
}

type ChatReply = {
  message?: { content?: string }
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
}

function replyMeta(item: { done_reason?: unknown; prompt_eval_count?: unknown; eval_count?: unknown }) {
  return {
    doneReason: typeof item.done_reason === 'string' ? item.done_reason : undefined,
    promptTokens: typeof item.prompt_eval_count === 'number' ? item.prompt_eval_count : undefined,
    replyTokens: typeof item.eval_count === 'number' ? item.eval_count : undefined,
  }
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
const isAbortError = (error: unknown) => (error as { name?: string } | null)?.name === 'AbortError'

function createOllamaClient(baseUrl: string) {
  async function post(path: string, body: unknown, signal?: AbortSignal) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`)
    return response
  }

  async function readStream(
    response: Response,
    extractText: (item: Record<string, unknown>) => string,
    onText: (text: string) => void,
    onDone?: (item: Record<string, unknown>) => void,
  ) {
    if (!response.body) throw new Error('Ollama did not return a response stream.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // Ollama streams newline-delimited JSON; chunks from fetch can split a JSON line anywhere.
    const consumeLine = (line: string) => {
      if (!line.trim()) return
      const item = JSON.parse(line) as Record<string, unknown>
      if (item.error) throw new Error(String(item.error))
      const text = extractText(item)
      if (text) onText(text)
      if (item.done) onDone?.(item)
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
  }

  /** With `parse`, the model's text is turned into structured data; a failure is logged against this request. */
  function chat<T>(request: ChatRequest & { parse: (text: string) => T }): Promise<T>
  function chat(request: ChatRequest): Promise<string>
  async function chat(request: ChatRequest & { parse?: (text: string) => unknown }): Promise<unknown> {
    const { model, messages, options, format, signal, label, parse } = request
    const entry = startDebugEntry({
      label: label ?? 'chat',
      endpoint: '/api/chat',
      model,
      streamed: false,
      request: { messages, options, format },
    })
    try {
      const response = await post('/api/chat', { model, messages, options, format, stream: false }, signal)
      const data = await response.json() as ChatReply
      const text = data.message?.content ?? ''
      entry.meta = replyMeta(data)
      finishDebugEntry(entry, 'ok', { response: text })
      if (!parse) return text
      try {
        return parse(text)
      } catch (error) {
        finishDebugEntry(entry, 'parse-failed', { error: errorMessage(error) })
        throw error
      }
    } catch (error) {
      if (entry.status === 'running') {
        finishDebugEntry(entry, isAbortError(error) ? 'aborted' : 'error', { error: errorMessage(error) })
      }
      throw error
    }
  }

  async function stream(
    path: string,
    body: Record<string, unknown>,
    init: { label: string; model: string; request: { messages?: OllamaChatMessage[]; prompt?: string; options: OllamaRequestOptions } },
    signal: AbortSignal | undefined,
    extractText: (item: Record<string, unknown>) => string,
    onText: (text: string) => void,
  ) {
    const entry = startDebugEntry({ ...init, endpoint: path, streamed: true })
    try {
      const response = await post(path, body, signal)
      await readStream(response, extractText, (text) => {
        appendDebugResponse(entry, text)
        onText(text)
      }, (item) => {
        entry.meta = replyMeta(item)
      })
      finishDebugEntry(entry, 'ok')
    } catch (error) {
      finishDebugEntry(entry, isAbortError(error) ? 'aborted' : 'error', { error: errorMessage(error) })
      throw error
    }
  }

  return {
    baseUrl,

    async listModels(): Promise<OllamaModel[]> {
      const response = await fetch(`${baseUrl}/api/tags`)
      if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`)
      const data = await response.json() as { models?: OllamaModel[] }
      return (data.models ?? []).map(model => ({ name: model.name, size: model.size }))
    },

    chat,

    async streamChat({ model, messages, options, signal, label }: ChatRequest, onText: (text: string) => void) {
      await stream('/api/chat', { model, messages, options, stream: true },
        { label: label ?? 'chat (streamed)', model, request: { messages, options } }, signal,
        item => (item.message as { content?: string } | undefined)?.content ?? '', onText)
    },

    async streamGenerate({ model, prompt, options, signal, label }: GenerateRequest, onText: (text: string) => void) {
      await stream('/api/generate', { model, prompt, options, stream: true },
        { label: label ?? 'generate (streamed)', model, request: { prompt, options } }, signal,
        item => typeof item.response === 'string' ? item.response : '', onText)
    },
  }
}

export const ollamaClient = createOllamaClient('http://localhost:11434')
