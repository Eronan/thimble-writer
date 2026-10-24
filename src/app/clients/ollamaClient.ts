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
}

type GenerateRequest = {
  model: string
  prompt: string
  options: OllamaRequestOptions
  signal?: AbortSignal
}

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

  return {
    baseUrl,

    async listModels(): Promise<OllamaModel[]> {
      const response = await fetch(`${baseUrl}/api/tags`)
      if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`)
      const data = await response.json() as { models?: OllamaModel[] }
      return (data.models ?? []).map(model => ({ name: model.name, size: model.size }))
    },

    async chat({ model, messages, options, format, signal }: ChatRequest): Promise<string> {
      const response = await post('/api/chat', { model, messages, options, format, stream: false }, signal)
      const data = await response.json() as { message?: { content?: string } }
      return data.message?.content ?? ''
    },

    async streamChat({ model, messages, options, signal }: ChatRequest, onText: (text: string) => void) {
      const response = await post('/api/chat', { model, messages, options, stream: true }, signal)
      await readStream(response, item => {
        const message = item.message as { content?: string } | undefined
        return message?.content ?? ''
      }, onText)
    },

    async streamGenerate({ model, prompt, options, signal }: GenerateRequest, onText: (text: string) => void) {
      const response = await post('/api/generate', { model, prompt, options, stream: true }, signal)
      await readStream(response, item => typeof item.response === 'string' ? item.response : '', onText)
    },
  }
}

export const ollamaClient = createOllamaClient('http://localhost:11434')
