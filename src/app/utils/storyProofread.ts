import { locateSection, paragraphsWithOffsets, type StorySectionSummary } from './storySections.ts'

export type StoryChunk = {
  start: number
  text: string
  summaries: string[]
}

export type ProofreadSuggestion = {
  quote: string
  // Optional disambiguation context. The model is no longer asked for it (it cost output tokens
  // and anchoring rewrites it from the real story anyway), but responses that include it still work.
  before: string
  after: string
  issue: string
  // The exact text that will be pasted in place of `quote`.
  replacement: string
}

export type AnchoredProofreadSuggestion = ProofreadSuggestion & {
  start: number
  end: number
}

export type ParsedProofreadResponse = {
  comments: ProofreadSuggestion[]
  incomplete: boolean
  skipped: number
}

export const proofreadResponseFormat = {
  type: 'object',
  properties: {
    comments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string' },
          issue: { type: 'string' },
          replacement: { type: 'string' },
        },
        required: ['quote', 'issue', 'replacement'],
        additionalProperties: false,
      },
    },
  },
  required: ['comments'],
  additionalProperties: false,
} satisfies Record<string, unknown>

export function splitStoryForProofreading(
  story: string,
  maxChars: number,
  sectionSummaries: StorySectionSummary[] = [],
): StoryChunk[] {
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new RangeError('Proofreading chunk size must be a positive integer.')
  }
  const chunks: StoryChunk[] = []
  const locatedSummaries = sectionSummaries
    .filter(section => section.summary.trim())
    .map(section => ({ section, range: locateSection(story, section) }))
    .filter((entry): entry is { section: StorySectionSummary; range: NonNullable<ReturnType<typeof locateSection>> } =>
      entry.range !== null,
    )
  let pendingStart: number | null = null
  let pendingEnd = 0
  let pendingSectionIndex: number | null = null

  const summariesForRange = (start: number, end: number) => {
    const relevant = locatedSummaries.filter(({ range }) => range.start < end && range.end > start)
    const preceding = locatedSummaries
      .filter(({ range }) => range.end <= start)
      .slice(-2)
    return [...new Set([...preceding, ...relevant].map(({ section }) => section.summary.trim()))]
  }

  const sectionIndexForParagraph = (start: number, end: number) => {
    const index = locatedSummaries.findIndex(({ range }) => range.start < end && range.end > start)
    return index === -1 ? null : index
  }

  const flush = () => {
    if (pendingStart === null) return
    chunks.push({
      start: pendingStart,
      text: story.slice(pendingStart, pendingEnd),
      summaries: summariesForRange(pendingStart, pendingEnd),
    })
    pendingStart = null
    pendingSectionIndex = null
  }

  for (const paragraph of paragraphsWithOffsets(story)) {
    const sectionIndex = sectionIndexForParagraph(paragraph.start, paragraph.end)
    if (pendingStart !== null && sectionIndex !== pendingSectionIndex) flush()

    if (paragraph.text.length > maxChars) {
      flush()
      let start = paragraph.start
      while (start < paragraph.end) {
        let end = Math.min(start + maxChars, paragraph.end)
        if (end < paragraph.end) {
          const preferredBoundary = story.lastIndexOf(' ', end - 1)
          const minimumBoundary = start + Math.floor(maxChars * 0.75)
          if (preferredBoundary >= minimumBoundary) end = preferredBoundary + 1
        }
        chunks.push({
          start,
          text: story.slice(start, end),
          summaries: summariesForRange(start, end),
        })
        start = end
      }
      continue
    }

    if (pendingStart === null) {
      pendingStart = paragraph.start
      pendingEnd = paragraph.end
      pendingSectionIndex = sectionIndex
    } else if (paragraph.end - pendingStart <= maxChars) {
      pendingEnd = paragraph.end
    } else {
      flush()
      pendingStart = paragraph.start
      pendingEnd = paragraph.end
      pendingSectionIndex = sectionIndex
    }
  }
  flush()
  return chunks
}

function parseJsonValue(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }

  return null
}

function extractJsonValue(response: string): unknown {
  const isResponse = (value: unknown) =>
    value !== null
    && typeof value === 'object'
    && 'comments' in value
    && Array.isArray(value.comments)
  const text = response.replace(/^\uFEFF/, '').trim()
  const candidates = [text]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  if (fenced) candidates.unshift(fenced)

  for (const candidate of candidates) {
    const parsed = parseJsonValue(candidate)
    if (isResponse(parsed)) return parsed
  }

  // Some models wrap otherwise valid JSON in a short preamble or code fence despite the format
  // constraint. Recover only a complete balanced JSON value; never repair or invent its contents.
  for (let start = 0; start < text.length; start++) {
    const opening = text[start]
    if (opening !== '{' && opening !== '[') continue
    const closings: string[] = []
    let inString = false
    let escaped = false
    for (let end = start; end < text.length; end++) {
      const character = text[end]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') {
        inString = true
      } else if (character === '{') {
        closings.push('}')
      } else if (character === '[') {
        closings.push(']')
      } else if (character === '}' || character === ']') {
        if (closings.pop() !== character) break
        if (!closings.length) {
          const parsed = parseJsonValue(text.slice(start, end + 1))
          if (isResponse(parsed)) return parsed
          break
        }
      }
    }
  }
  const excerpt = text.slice(0, 180).replace(/\s+/g, ' ')
  throw new Error(`Ollama returned invalid structured proofreading data. Response begins: ${excerpt || '(empty response)'}`)
}

function parseProofreadComments(comments: unknown[]): { comments: ProofreadSuggestion[]; skipped: number } {
  const parsed: ProofreadSuggestion[] = []
  let skipped = 0
  for (const comment of comments) {
    if (!comment || typeof comment !== 'object') {
      skipped++
      continue
    }
    const candidate = comment as Record<string, unknown>
    const quote = typeof candidate.quote === 'string' ? candidate.quote.trim() : ''
    const issue = typeof candidate.issue === 'string' ? candidate.issue.trim() : ''
    const replacement = typeof candidate.replacement === 'string' ? candidate.replacement.trim() : ''
    // An empty replacement is indistinguishable from "nothing to change", so it is not a fix.
    if (!quote || !issue || !replacement) {
      skipped++
      continue
    }
    parsed.push({
      quote,
      before: typeof candidate.before === 'string' ? candidate.before : '',
      after: typeof candidate.after === 'string' ? candidate.after : '',
      issue,
      replacement,
    })
  }
  return { comments: parsed, skipped }
}

function extractCompletedProofreadComments(response: string): ParsedProofreadResponse {
  const opening = /"comments"\s*:\s*\[/.exec(response)
  if (!opening || opening.index === undefined) {
    throw new Error('Ollama returned invalid structured proofreading data.')
  }
  const arrayStart = opening.index + opening[0].length
  const comments: unknown[] = []
  let objectStart = -1
  let objectDepth = 0
  let inString = false
  let escaped = false

  for (let index = arrayStart; index < response.length; index++) {
    const character = response[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
    } else if (character === '{') {
      if (objectDepth === 0) objectStart = index
      objectDepth++
    } else if (character === '}') {
      objectDepth--
      if (objectDepth < 0) break
      if (objectDepth === 0 && objectStart !== -1) {
        const parsed = parseJsonValue(response.slice(objectStart, index + 1))
        if (parsed === null) break
        comments.push(parsed)
        objectStart = -1
      }
    } else if (character === ']' && objectDepth === 0) {
      return { ...parseProofreadComments(comments), incomplete: false }
    }
  }

  if (!comments.length) {
    throw new Error('Ollama returned truncated proofreading data without any complete comments.')
  }
  return { ...parseProofreadComments(comments), incomplete: true }
}

export function parseProofreadResponse(response: string): ParsedProofreadResponse {
  try {
    const parsed = extractJsonValue(response)
    if (!parsed || typeof parsed !== 'object' || !('comments' in parsed) || !Array.isArray(parsed.comments)) {
      throw new Error('Ollama returned structured proofreading data without a comments list.')
    }
    return { ...parseProofreadComments(parsed.comments), incomplete: false }
  } catch (cause) {
    if (cause instanceof Error && /incomplete proofreading comment/.test(cause.message)) {
      throw cause
    }
    return extractCompletedProofreadComments(response)
  }
}

export type ProofreadOutcome = {
  added: number
  // Everything the model returned, whether or not it was usable.
  suggested: number
  malformed: number
  unanchored: number
  overlapping: number
  unsafe: number
  truncatedResponses: number
}

// "Nothing happened" has several different causes with different remedies (an empty model reply,
// a quote the model did not copy exactly, suggestions colliding with comments already queued, a
// replacement that looked like a rewrite), so say which one it was instead of one vague message.
export function describeProofreadOutcome(outcome: ProofreadOutcome): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
  const reasons = [
    outcome.unanchored
      ? `${plural(outcome.unanchored, 'quote')} not found exactly once in the story`
      : '',
    outcome.overlapping
      ? `${plural(outcome.overlapping, 'suggestion')} overlapping a comment or fix already queued`
      : '',
    outcome.unsafe
      ? `${plural(outcome.unsafe, 'replacement')} that looked like a rewrite rather than a local fix`
      : '',
    outcome.malformed ? `${plural(outcome.malformed, 'incomplete suggestion')}` : '',
  ].filter(Boolean).join('; ')
  const truncated = outcome.truncatedResponses
    ? `; recovered complete suggestions from ${plural(outcome.truncatedResponses, 'truncated response')}`
    : ''

  if (outcome.added) {
    return `Proofreading added ${plural(outcome.added, 'suggested fix').replace('fixs', 'fixes')}${reasons ? `; skipped ${reasons}` : ''}${truncated}`
  }
  if (outcome.suggested) {
    return `The model made ${plural(outcome.suggested, 'suggestion')}, but none could be added: ${reasons || 'none were usable'}${truncated}`
  }
  if (outcome.truncatedResponses) {
    return `Proofreading response was truncated and contained no complete suggestions${truncated}`
  }
  return 'The model returned no suggestions. Check the Developer tab for its raw reply.'
}

export function anchorProofreadSuggestions(
  chunk: StoryChunk,
  suggestions: ProofreadSuggestion[],
): { comments: AnchoredProofreadSuggestion[]; skipped: number } {
  const comments: AnchoredProofreadSuggestion[] = []
  let skipped = 0
  for (const suggestion of suggestions) {
    const exactMatches: number[] = []
    const quoteMatches: number[] = []
    let searchFrom = 0
    while (true) {
      const candidate = chunk.text.indexOf(suggestion.quote, searchFrom)
      if (candidate === -1) break
      searchFrom = candidate + 1
      quoteMatches.push(candidate)
      const beforeStart = candidate - suggestion.before.length
      const afterStart = candidate + suggestion.quote.length
      if (
        beforeStart >= 0
        && chunk.text.slice(beforeStart, candidate) === suggestion.before
        && chunk.text.slice(afterStart, afterStart + suggestion.after.length) === suggestion.after
      ) {
        exactMatches.push(candidate)
      }
    }
    const matchStart = exactMatches.length === 1
      ? exactMatches[0]
      : exactMatches.length === 0 && quoteMatches.length === 1
        ? quoteMatches[0]
        : -1
    if (matchStart === -1) {
      skipped++
      continue
    }
    comments.push({
      ...suggestion,
      before: chunk.text.slice(Math.max(0, matchStart - 80), matchStart),
      after: chunk.text.slice(matchStart + suggestion.quote.length, matchStart + suggestion.quote.length + 80),
      start: chunk.start + matchStart,
      end: chunk.start + matchStart + suggestion.quote.length,
    })
  }
  return { comments, skipped }
}
