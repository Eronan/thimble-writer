import { evolutionBudget } from './contextBudget.ts'
import type { LoreNote } from './loreWorkspace.ts'
import { paragraphsWithOffsets, type StorySectionSummary } from './storySections.ts'
import { selectSummaryContext } from './storySummary.ts'

export type EvolutionField = 'details' | 'appearance'
export type EvolutionOp = 'add' | 'replace' | 'remove'
export type EvolutionFields = { details: string; appearance: string }

export const EVOLUTION_FIELDS: EvolutionField[] = ['details', 'appearance']
const EVOLUTION_OPS: EvolutionOp[] = ['add', 'replace', 'remove']
export const MAX_CHANGES_PER_CHARACTER = 5
export const MAX_NEW_TEXT_CHARS = 400
export const MIN_EVIDENCE_CHARS = 8
const MAX_EVIDENCE_DISPLAY_CHARS = 240

// ---------------------------------------------------------------------------------------------
// Which characters does a chapter involve?

// Words that are part of a name but would match far too much on their own.
const NAME_STOPWORDS = new Set([
  'the', 'of', 'and', 'an', 'de', 'la', 'le', 'el', 'von', 'van', 'der',
  'mr', 'mrs', 'ms', 'dr', 'sir', 'lady', 'lord', 'captain', 'king', 'queen',
])

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The full name or any distinctive part of it ("Mara Voss" also finds "Mara" and "Voss"), as whole
// words only. Plain matching is deliberate: it needs no model call and the writer can correct it.
export function nameMatcher(name: string): RegExp | null {
  const full = name.trim()
  if (!full) return null
  const parts = full.split(/\s+/).filter(part => part.length >= 3 && !NAME_STOPWORDS.has(part.toLowerCase()))
  const alternatives = [...new Set([full, ...parts])]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}_])`, 'iu')
}

export function mentionParagraphs(story: string, name: string): string[] {
  const matcher = nameMatcher(name)
  if (!matcher) return []
  return paragraphsWithOffsets(story)
    .map(paragraph => paragraph.text.trim())
    .filter(text => matcher.test(text))
}

// character id -> number of paragraphs that mention them (characters never mentioned are absent)
export function findMentionedCharacters(story: string, characters: LoreNote[]): Map<string, number> {
  const found = new Map<string, number>()
  for (const character of characters) {
    const count = mentionParagraphs(story, character.name).length
    if (count) found.set(character.id, count)
  }
  return found
}

// ---------------------------------------------------------------------------------------------
// The request

export const evolutionSystem = [
  'You update one character entry in a story bible after reading a chapter.',
  'Propose only lasting changes the chapter clearly shows: injuries or other lasting physical changes, new or changed relationships, new goals or motives, important knowledge gained or secrets learned, changes of status or role, and changes of appearance.',
  'Do not record what merely happened in a scene; scene events are tracked elsewhere. Do not repeat facts the entry already states.',
  'Return a JSON object with a changes array of at most five changes. Each change has: field (details or appearance); op (add, replace, or remove); old (for replace or remove, the exact existing text being changed, copied from the entry; otherwise an empty string); new (for add or replace, the new concise text of one or two sentences; otherwise an empty string); reason (under 15 words); evidence (an exact quote of under 25 words copied from the chapter passages that shows the change).',
  'Prefer add. Use replace only when the chapter contradicts or supersedes something in the entry, and copy old exactly. If nothing lasting changed, return an empty changes array.',
].join(' ')

export const evolutionResponseFormat = {
  type: 'object',
  properties: {
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: EVOLUTION_FIELDS },
          op: { type: 'string', enum: EVOLUTION_OPS },
          old: { type: 'string' },
          new: { type: 'string' },
          reason: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['field', 'op', 'old', 'new', 'reason', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['changes'],
  additionalProperties: false,
} satisfies Record<string, unknown>

export type EvolutionRequestInput = {
  character: LoreNote
  chapterStory: string
  summaries: StorySectionSummary[]
  numCtx: number
}

export type EvolutionRequest = {
  messages: Array<{ role: 'system' | 'user'; content: string }>
  outputTokens: number
  passageCount: number
  // Earlier mentions that did not fit; the chapter summaries stand in for them.
  omittedPassages: number
}

function characterEntry(character: LoreNote): string {
  return [
    `Name: ${character.name.trim()}`,
    character.characterType?.trim() ? `Type: ${character.characterType.trim()}` : '',
    `Details:\n${character.details.trim() || '(empty)'}`,
    `Appearance:\n${character.appearance?.trim() || '(empty)'}`,
  ].filter(Boolean).join('\n')
}

// Returns null when the chapter never mentions the character, so there is nothing to ask about.
// The model sees the entry, the chapter's summaries for orientation, and only the paragraphs that
// mention the character, newest first when space runs out (older events are in the summaries).
export function buildEvolutionRequest(input: EvolutionRequestInput): EvolutionRequest | null {
  const mentions = mentionParagraphs(input.chapterStory, input.character.name)
  if (!mentions.length) return null

  const budget = evolutionBudget(input.numCtx)
  const entry = `Character entry:\n${characterEntry(input.character)}`
  const closing = 'Propose changes to the entry based on this chapter.'
  const fixed = evolutionSystem.length + entry.length + closing.length + 160
  const remaining = budget.inputChars - fixed
  if (remaining < 200) {
    throw new RangeError('This character entry is too large for the model context. Shorten it or increase the context size.')
  }

  const summaryLines = selectSummaryContext(
    input.chapterStory,
    input.summaries,
    input.chapterStory.length,
    Math.floor(remaining * 0.3),
  )
  const summaryBlock = summaryLines.length ? `Chapter summaries so far:\n${summaryLines.join('\n')}` : ''
  let passageBudget = remaining - summaryBlock.length - 80

  const kept: string[] = []
  for (let index = mentions.length - 1; index >= 0; index--) {
    const passage = mentions[index]!
    const additional = passage.length + 2
    if (additional > passageBudget) {
      // Never send nothing: clip the newest passage if it alone is too big.
      if (!kept.length && passageBudget > 80) kept.push(passage.slice(-(passageBudget - 2)))
      break
    }
    kept.unshift(passage)
    passageBudget -= additional
  }

  const user = [
    entry,
    summaryBlock,
    `Chapter passages mentioning ${input.character.name.trim()} (verbatim, in story order):\n${kept.join('\n\n')}`,
    closing,
  ].filter(Boolean).join('\n\n')
  return {
    outputTokens: budget.outputTokens,
    messages: [
      { role: 'system', content: evolutionSystem },
      { role: 'user', content: user },
    ],
    passageCount: kept.length,
    omittedPassages: mentions.length - kept.length,
  }
}

// ---------------------------------------------------------------------------------------------
// The response

export type RawEvolutionChange = {
  field: EvolutionField
  op: EvolutionOp
  old: string
  new: string
  reason: string
  evidence: string
}

export function parseEvolutionResponse(response: string): { changes: RawEvolutionChange[]; skipped: number } {
  let parsed: unknown
  try {
    parsed = JSON.parse(response.replace(/^\uFEFF/, '').trim())
  } catch {
    throw new Error('Ollama returned invalid structured character-evolution data.')
  }
  if (!parsed || typeof parsed !== 'object' || !('changes' in parsed) || !Array.isArray(parsed.changes)) {
    throw new Error('Ollama returned character-evolution data without a changes list.')
  }
  const changes: RawEvolutionChange[] = []
  let skipped = 0
  for (const item of parsed.changes as unknown[]) {
    const candidate = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const text = (key: string) => (typeof candidate[key] === 'string' ? candidate[key].trim() : '')
    const field = candidate.field
    const op = candidate.op
    if (
      !EVOLUTION_FIELDS.includes(field as EvolutionField)
      || !EVOLUTION_OPS.includes(op as EvolutionOp)
      || !text('reason')
    ) {
      skipped++
      continue
    }
    changes.push({
      field: field as EvolutionField,
      op: op as EvolutionOp,
      old: text('old'),
      new: text('new'),
      reason: text('reason'),
      evidence: text('evidence'),
    })
  }
  return { changes, skipped }
}

// ---------------------------------------------------------------------------------------------
// Checking a proposal against the real text

// Lowercase, one space per whitespace run, straight quotes: enough that a model re-typing a quote
// does not fail on trivia, while the match is still found in the actual chapter text.
function normalizeWithMap(text: string): { text: string; map: number[] } {
  let out = ''
  const map: number[] = []
  let lastWasSpace = true
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (/\s/.test(char)) {
      if (!lastWasSpace) {
        out += ' '
        map.push(index)
      }
      lastWasSpace = true
      continue
    }
    lastWasSpace = false
    const straight = char.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase()
    for (const piece of straight) {
      out += piece
      map.push(index)
    }
  }
  return { text: out, map }
}

export function findNormalized(haystack: string, needle: string): { start: number; end: number } | null {
  const target = normalizeWithMap(needle).text.trimEnd()
  if (target.length < MIN_EVIDENCE_CHARS) return null
  const source = normalizeWithMap(haystack)
  const at = source.text.indexOf(target)
  if (at === -1) return null
  return { start: source.map[at]!, end: source.map[at + target.length - 1]! + 1 }
}

const containsNormalized = (text: string, piece: string) => {
  const target = normalizeWithMap(piece).text.trimEnd()
  return Boolean(target) && normalizeWithMap(text).text.includes(target)
}

// An old text only counts when it appears exactly once, so the edit cannot land in the wrong place.
function locateOnce(text: string, old: string): { start: number; end: number } | null {
  if (!old) return null
  const first = text.indexOf(old)
  if (first === -1 || text.indexOf(old, first + 1) !== -1) return null
  return { start: first, end: first + old.length }
}

export type EvolutionChange = RawEvolutionChange

export type EvolutionSkips = {
  evidence: number
  unmatched: number
  duplicate: number
  size: number
  limit: number
}

// Keeps only changes that are anchored in reality: the evidence must be in the chapter, text to
// replace or remove must be in the entry exactly once, and additions must be new and short. The
// evidence shown to the writer is the chapter's own wording, not the model's copy of it.
export function validateEvolutionChanges(
  fields: EvolutionFields,
  chapterStory: string,
  raw: RawEvolutionChange[],
): { changes: EvolutionChange[]; skipped: EvolutionSkips } {
  const skipped: EvolutionSkips = { evidence: 0, unmatched: 0, duplicate: 0, size: 0, limit: 0 }
  const changes: EvolutionChange[] = []
  const seen = new Set<string>()
  for (const change of raw) {
    if (changes.length >= MAX_CHANGES_PER_CHARACTER) {
      skipped.limit++
      continue
    }
    const text = fields[change.field]
    const needsOld = change.op !== 'add'
    const needsNew = change.op !== 'remove'
    if (needsNew && (!change.new || change.new.length > MAX_NEW_TEXT_CHARS)) {
      skipped.size++
      continue
    }
    if (needsOld && !locateOnce(text, change.old)) {
      skipped.unmatched++
      continue
    }
    if (change.op === 'replace' && change.new === change.old) {
      skipped.duplicate++
      continue
    }
    if (change.op === 'add' && containsNormalized(text, change.new)) {
      skipped.duplicate++
      continue
    }
    const evidence = findNormalized(chapterStory, change.evidence)
    if (!evidence) {
      skipped.evidence++
      continue
    }
    const key = [change.field, change.op, change.old, change.new].join('\u0000')
    if (seen.has(key)) {
      skipped.duplicate++
      continue
    }
    seen.add(key)
    const quote = chapterStory.slice(evidence.start, evidence.end).replace(/\s+/g, ' ').trim()
    changes.push({
      field: change.field,
      op: change.op,
      old: needsOld ? change.old : '',
      new: needsNew ? change.new : '',
      reason: change.reason,
      evidence: quote.length > MAX_EVIDENCE_DISPLAY_CHARS ? `${quote.slice(0, MAX_EVIDENCE_DISPLAY_CHARS - 1)}…` : quote,
    })
  }
  return { changes, skipped }
}

export function describeEvolutionSkips(skipped: EvolutionSkips): string {
  const parts = [
    skipped.evidence ? `${skipped.evidence} with evidence not found in the chapter` : '',
    skipped.unmatched ? `${skipped.unmatched} whose old text is not in the entry exactly once` : '',
    skipped.duplicate ? `${skipped.duplicate} already in the entry or repeated` : '',
    skipped.size ? `${skipped.size} with missing or overlong text` : '',
    skipped.limit ? `${skipped.limit} beyond the limit of ${MAX_CHANGES_PER_CHARACTER}` : '',
  ].filter(Boolean)
  return parts.join('; ')
}

// ---------------------------------------------------------------------------------------------
// Selecting and applying

export type EvolutionTarget = {
  id: string
  field: EvolutionField
  op: EvolutionOp
  old: string
  new: string
}

// ready: can be applied now. stale: the old text is gone or no longer unique (the entry changed
// since the proposal). duplicate: the addition is already there. conflict: overlaps another
// selected change in the same field; only the earlier one in the text can be applied.
export type EvolutionState = 'ready' | 'stale' | 'duplicate' | 'conflict'

export function evaluateEvolutionChanges(
  fields: EvolutionFields,
  changes: Array<EvolutionTarget & { selected: boolean }>,
): Map<string, EvolutionState> {
  const states = new Map<string, EvolutionState>()
  const edits: Array<{ id: string; field: EvolutionField; start: number; end: number }> = []
  for (const change of changes) {
    const text = fields[change.field]
    if (change.op === 'add') {
      states.set(change.id, containsNormalized(text, change.new) ? 'duplicate' : 'ready')
      continue
    }
    const range = locateOnce(text, change.old)
    if (!range) {
      states.set(change.id, 'stale')
      continue
    }
    states.set(change.id, 'ready')
    if (change.selected) edits.push({ id: change.id, field: change.field, ...range })
  }
  for (const field of EVOLUTION_FIELDS) {
    let previousEnd = -1
    for (const edit of edits.filter(item => item.field === field).sort((a, b) => a.start - b.start)) {
      if (edit.start < previousEnd) states.set(edit.id, 'conflict')
      else previousEnd = edit.end
    }
  }
  return states
}

function appendText(text: string, addition: string): string {
  const base = text.trimEnd()
  if (!base) return addition
  // Continue a single prose paragraph on the same line; otherwise start a new line.
  const separator = !base.includes('\n') && /[.!?…"”')\]]$/.test(base) ? ' ' : '\n'
  return `${base}${separator}${addition}`
}

export type EvolutionApplication = EvolutionFields & {
  applied: string[]
  failed: Array<{ id: string; reason: Exclude<EvolutionState, 'ready'> }>
}

// Every change is located in the entry as it is now; replacements and removals are spliced from
// the end backwards so they cannot shift each other, then additions are appended in order.
export function applyEvolutionChanges(fields: EvolutionFields, changes: EvolutionTarget[]): EvolutionApplication {
  const states = evaluateEvolutionChanges(fields, changes.map(change => ({ ...change, selected: true })))
  const result: EvolutionFields = { ...fields }
  const applied: string[] = []
  const failed: EvolutionApplication['failed'] = []

  for (const field of EVOLUTION_FIELDS) {
    const mine = changes.filter(change => change.field === field)
    const edits: Array<{ change: EvolutionTarget; start: number; end: number }> = []
    for (const change of mine) {
      const state = states.get(change.id) ?? 'stale'
      if (state !== 'ready') {
        failed.push({ id: change.id, reason: state })
        continue
      }
      if (change.op === 'add') continue
      const range = locateOnce(fields[field], change.old)
      if (range) edits.push({ change, ...range })
    }
    let text = fields[field]
    for (const { change, start, end } of [...edits].sort((a, b) => b.start - a.start)) {
      const before = text.slice(0, start)
      const after = text.slice(end)
      const insert = change.op === 'replace' ? change.new : ''
      text = change.op === 'remove' && before.endsWith(' ') && after.startsWith(' ')
        ? `${before}${after.slice(1)}`
        : `${before}${insert}${after}`
      applied.push(change.id)
    }
    for (const change of mine.filter(item => item.op === 'add' && states.get(item.id) === 'ready')) {
      if (containsNormalized(text, change.new)) {
        failed.push({ id: change.id, reason: 'duplicate' })
        continue
      }
      text = appendText(text, change.new)
      applied.push(change.id)
    }
    result[field] = text
  }
  return { ...result, applied, failed }
}
