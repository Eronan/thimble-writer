import { reactive } from 'vue'

// An in-memory record of every request sent to Ollama and what came back, for the Developer tab.
// It is never saved: it can hold your whole story and prompts, and it resets when the page reloads.

export type DebugStatus = 'running' | 'ok' | 'parse-failed' | 'error' | 'aborted'

export type DebugEntry = {
  id: number
  label: string
  endpoint: string
  model: string
  streamed: boolean
  startedAt: number
  durationMs: number | null
  status: DebugStatus
  request: {
    messages?: { role: string; content: string }[]
    prompt?: string
    options: Record<string, unknown>
    format?: unknown
  }
  /** The raw text the model returned, exactly as received (before any parsing). */
  response: string
  /** HTTP/network error, or the message thrown by the structured-data parser. */
  error: string
  meta: { doneReason?: string; promptTokens?: number; replyTokens?: number }
}

type DebugEntryInit = Pick<DebugEntry, 'label' | 'endpoint' | 'model' | 'streamed' | 'request'>

const MAX_ENTRIES = 80
const MAX_RESPONSE_CHARS = 200_000
let nextId = 1

/** Newest first. */
export const debugEntries = reactive<DebugEntry[]>([])

export function startDebugEntry(init: DebugEntryInit): DebugEntry {
  debugEntries.unshift({
    id: nextId++,
    ...init,
    startedAt: Date.now(),
    durationMs: null,
    status: 'running',
    response: '',
    error: '',
    meta: {},
  })
  if (debugEntries.length > MAX_ENTRIES) debugEntries.length = MAX_ENTRIES
  // Return the reactive proxy, so later changes show up in the UI.
  return debugEntries[0]!
}

export function appendDebugResponse(entry: DebugEntry, text: string) {
  if (entry.response.length < MAX_RESPONSE_CHARS) entry.response += text
}

export function finishDebugEntry(
  entry: DebugEntry,
  status: DebugStatus,
  patch: { response?: string; error?: string } = {},
) {
  if (patch.response !== undefined) entry.response = patch.response.slice(0, MAX_RESPONSE_CHARS)
  if (patch.error !== undefined) entry.error = patch.error
  if (entry.durationMs === null) entry.durationMs = Date.now() - entry.startedAt
  entry.status = status
}

export function clearDebugEntries() {
  debugEntries.length = 0
}

export function isDebugProblem(entry: Pick<DebugEntry, 'status'>) {
  return entry.status === 'parse-failed' || entry.status === 'error' || entry.status === 'aborted'
}

function tryParseJson(text: string): { ok: true } | { ok: false; message: string } {
  try {
    JSON.parse(text)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** Plain-language hints about why a response may not have turned into structured data. */
export function diagnoseEntry(entry: DebugEntry): string[] {
  const hints: string[] = []
  const response = entry.response
  const trimmed = response.trim()
  const wantedJson = entry.request.format !== undefined && entry.request.format !== null
  const numCtx = Number(entry.request.options.num_ctx)

  if (entry.status === 'error' && /failed to fetch|networkerror|load failed/i.test(entry.error)) {
    hints.push('The browser could not reach Ollama. Check that Ollama is running and that this page is allowed to call it.')
  }
  if (entry.status === 'aborted') hints.push('The request was cancelled before it finished.')
  if (entry.status === 'running') return hints

  if (entry.meta.doneReason === 'length') {
    hints.push('The model stopped at the token limit (done_reason: length), so the reply is cut off. Raise Max tokens, or shorten what you send.')
  }
  if (entry.meta.promptTokens !== undefined && Number.isFinite(numCtx) && entry.meta.promptTokens >= numCtx - 8) {
    hints.push(`The prompt used ${entry.meta.promptTokens} of ${numCtx} context tokens, so Ollama may have dropped the start of it. Raise Context size or send less.`)
  }
  if (entry.status !== 'error' && entry.status !== 'aborted' && !trimmed) {
    hints.push('The model returned an empty response.')
  }
  if (wantedJson && trimmed) {
    if (/^```/.test(trimmed)) hints.push('The JSON is wrapped in a Markdown code fence, which a strict parser will reject.')
    if (!/^[\[{]/.test(trimmed.replace(/^```(?:json)?\s*/i, ''))) {
      hints.push('The reply is not JSON at all: the model ignored the requested format. Small models do this; try a lower temperature or a larger model.')
    } else {
      const json = tryParseJson(trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''))
      if (!json.ok) {
        const unfinished = !/[\]}]\s*$/.test(trimmed)
        hints.push(unfinished
          ? `The JSON is invalid and appears to end early (${json.message}). The reply was probably cut off.`
          : `The JSON is invalid: ${json.message}`)
      } else if (entry.status === 'parse-failed') {
        hints.push('The JSON is valid, but its shape was not what the app expects. See the parser error below.')
      }
    }
  }
  if (entry.status === 'parse-failed' && !hints.length) {
    hints.push('The reply could not be turned into structured data. See the parser error below.')
  }
  return hints
}
