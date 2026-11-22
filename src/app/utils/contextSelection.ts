import { loreSelectorBudget } from './contextBudget.ts'
import type { ContextGroup, ContextItem } from './loreWorkspace.ts'
import { paragraphsWithOffsets, type StorySectionSummary } from './storySections.ts'
import { selectSummaryContext } from './storySummary.ts'

// How many of the latest scene summaries describe "where the story is now" to the selector.
export const CONTEXT_SELECTION_SCENE_COUNT = 3
// Share of the selector's input kept for the story side, so the entries always get room.
export const CONTEXT_SELECTION_STORY_SHARE = 0.5

export const contextSelectionSystem = [
  'You choose which story-setup entries a fiction co-writer needs for the next passage.',
  'You are given the writing direction, a chapter synopsis, recent scene summaries, the most recent story text, and a numbered list of setup entries (synopsis, writing guidance, characters, settings).',
  'Select every entry the next passage is likely to need: characters who are present, mentioned, or about to appear; settings where the action is or is heading; synopsis points that apply to this part of the story; and writing guidance that applies to this passage.',
  'Leave out entries about unrelated people, places, or plot points. Use the story text and summaries only to judge relevance; they are not entries.',
  'Some entry text may be clipped, but every entry number is included.',
  'Return only a JSON object with an items array of the selected entry numbers. Never invent numbers.',
].join(' ')

export const contextSelectionResponseFormat = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'integer' } },
  },
  required: ['items'],
  additionalProperties: false,
} satisfies Record<string, unknown>

export type ContextSelectionInput = {
  items: ContextItem[]
  story: string
  summaries: StorySectionSummary[]
  prompt: string
  chapterSynopsis: string
  writerParagraphs: number
  numCtx: number
}

export type ContextSelectionRequest = {
  messages: Array<{ role: 'system' | 'user'; content: string }>
  outputTokens: number
}

const groupNames: Record<ContextGroup, string> = {
  synopsis: 'Synopsis',
  guidance: 'Writing guidance',
  characters: 'Character',
  setting: 'Setting',
}

const clipStart = (text: string, maxChars: number) =>
  text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1))}…`
const clipEnd = (text: string, maxChars: number) =>
  text.length <= maxChars ? text : `…${text.slice(-Math.max(0, maxChars - 1))}`
const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

// Everything that says "what happens next", in priority order: the writing direction, the chapter
// synopsis, the last few scenes, then the newest raw paragraphs. Each part has a cap, and the raw
// paragraphs take whatever is left, keeping their end because that is where the story is now.
function buildStorySide(input: ContextSelectionInput, capChars: number): string {
  const prompt = clipStart(input.prompt.trim(), Math.floor(capChars * 0.25))
  const synopsis = clipStart(input.chapterSynopsis.trim(), Math.floor(capChars * 0.15))
  const scenes = selectSummaryContext(
    input.story,
    input.summaries,
    input.story.length,
    Math.floor(capChars * 0.25),
  ).slice(-CONTEXT_SELECTION_SCENE_COUNT)

  const parts: string[] = []
  if (prompt) parts.push(`Writing direction for the next passage:\n${prompt}`)
  if (synopsis) parts.push(`Chapter synopsis:\n${synopsis}`)
  if (scenes.length) parts.push(`Recent scenes (oldest first):\n${scenes.join('\n')}`)

  const recentCount = Math.max(1, Math.floor(input.writerParagraphs) || 3)
  const recent = paragraphsWithOffsets(input.story)
    .slice(-recentCount)
    .map(paragraph => paragraph.text.trim())
    .join('\n')
  const used = parts.join('\n\n').length + (parts.length ? 2 : 0)
  const remaining = capChars - used - 'Most recent story text:\n'.length
  if (recent && remaining > 0) parts.push(`Most recent story text:\n${clipEnd(recent, remaining)}`)
  return parts.join('\n\n')
}

// Every entry is listed (evenly clipped if the window is tight) so the model can tick or untick
// anything; dropping entries from the list would silently decide their fate for it.
function listItems(items: ContextItem[], maxChars: number): string {
  const labels = items.map((item, index) => `[${index + 1}] ${groupNames[item.group]} · ${flatten(item.label)}: `)
  const marker = ' [clipped]'
  const fixed = labels.reduce((total, label) => total + label.length, 0)
    + Math.max(0, items.length - 1)
    + items.length * marker.length
  const perItem = Math.floor((maxChars - fixed) / items.length)
  if (perItem < 1) {
    throw new RangeError('The context is too small to list every setup entry for selection. Increase the context size.')
  }
  return items.map((item, index) => {
    const text = flatten(item.text)
    const excerpt = text.slice(0, perItem)
    return `${labels[index]}${excerpt}${excerpt.length < text.length ? marker : ''}`
  }).join('\n')
}

export function buildContextSelectionRequest(input: ContextSelectionInput): ContextSelectionRequest {
  if (!input.items.length) throw new RangeError('There are no setup entries to select from.')
  const base = loreSelectorBudget(input.numCtx, 0, contextSelectionSystem.length)
  const storySide = buildStorySide(input, Math.floor(base.inputChars * CONTEXT_SELECTION_STORY_SHARE))
  const budget = loreSelectorBudget(input.numCtx, storySide.length, contextSelectionSystem.length)
  const list = listItems(input.items, budget.loreEntriesChars)
  const user = [
    storySide,
    `Numbered setup entries:\n${list}`,
    'Return the numbers of the entries the next passage needs.',
  ].filter(Boolean).join('\n\n')
  return {
    outputTokens: budget.outputTokens,
    messages: [
      { role: 'system', content: contextSelectionSystem },
      { role: 'user', content: user },
    ],
  }
}

export function parseContextSelectionResponse(response: string, itemCount: number): number[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(response)
  } catch {
    throw new Error('Ollama returned invalid structured context-selection data.')
  }
  if (
    !parsed
    || typeof parsed !== 'object'
    || !('items' in parsed)
    || !Array.isArray(parsed.items)
    || !parsed.items.every(number => Number.isInteger(number))
  ) {
    throw new Error('Ollama returned a context selection without a valid items list.')
  }
  return [...new Set(parsed.items as number[])].filter(number => number >= 1 && number <= itemCount)
}

export type ContextSelectionResult = {
  disabledIds: string[]
  ticked: number
  total: number
  // Entries whose tick state differs from before.
  changed: number
}

// The selection is authoritative for the entries it was shown: chosen ones are ticked and the
// rest unticked. Exclusions for ids that are not in this list are left alone.
export function applyContextSelection(
  items: ContextItem[],
  selectedNumbers: number[],
  disabledIds: string[],
): ContextSelectionResult {
  const chosen = new Set(selectedNumbers)
  const shown = new Set(items.map(item => item.id))
  const wasDisabled = new Set(disabledIds)
  const nextDisabled: string[] = disabledIds.filter(id => !shown.has(id))
  let ticked = 0
  let changed = 0
  items.forEach((item, index) => {
    const disable = !chosen.has(index + 1)
    if (disable) nextDisabled.push(item.id)
    else ticked++
    if (disable !== wasDisabled.has(item.id)) changed++
  })
  return { disabledIds: nextDisabled, ticked, total: items.length, changed }
}
