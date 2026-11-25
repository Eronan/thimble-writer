import { loreSelectorBudget } from './contextBudget.ts'
import {
  contextGroupNames,
  contextItemText,
  contextSelectionResponseFormat,
  listContextItems,
  parseContextSelectionResponse,
} from './contextSelection.ts'
import type { ContextItem } from './loreWorkspace.ts'

// Re-exported so the summarizer uses exactly the same structured-output contract as the
// write-time pick: an `items` array of entry numbers.
export const summaryPickResponseFormat = contextSelectionResponseFormat
export const parseSummaryPickResponse = parseContextSelectionResponse

export const summaryPickSystem = [
  'You choose which story-setup entries a summarizer needs to correctly name the people, places, and things in one section of a story.',
  'You are given the section, summaries of earlier sections, and a numbered list of setup entries (characters, settings, synopsis).',
  'Select every entry the section mentions or refers to, including by pronoun, nickname, title, or role (for example "the old man", or "she" when the earlier summaries show who that is), and any entry needed to understand who or what is involved.',
  'Leave out entries unrelated to this section. Use the earlier summaries only to resolve who is being referred to; they are not entries.',
  'Some entry text may be clipped, but every entry number is included.',
  'Return only a JSON object with an items array of the selected entry numbers. Never invent numbers.',
].join(' ')

// Writing guidance is about voice and style for new prose; it cannot help identify anyone in an
// existing section, so it is never offered to the summarizer.
export function summaryPickCandidates(items: ContextItem[]): ContextItem[] {
  return items.filter(item => item.group !== 'guidance')
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()
const clipStart = (text: string, maxChars: number) =>
  text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1))}…`

export type SummaryPickInput = {
  items: ContextItem[]
  sectionText: string
  // Summary lines of earlier sections, oldest first.
  background: string[]
  chapterSynopsis: string
  numCtx: number
}

export type SummaryPickRequest = {
  messages: Array<{ role: 'system' | 'user'; content: string }>
  outputTokens: number
}

// One small call per section, made before it is summarized. The pick is only used for that one
// summary request; it never changes the writer's Context ticks. Throws RangeError when the
// section plus every entry cannot fit the model window, so the caller can fall back.
export function buildSummaryPickRequest(input: SummaryPickInput): SummaryPickRequest {
  if (!input.items.length) throw new RangeError('There are no setup entries to select from.')
  const base = loreSelectorBudget(input.numCtx, 0, summaryPickSystem.length)

  const backgroundCap = Math.floor(base.inputChars * 0.15)
  const backgroundLines: string[] = []
  let used = 0
  for (let index = input.background.length - 1; index >= 0; index--) {
    const line = input.background[index]!.trim()
    if (!line) continue
    if (used + line.length + 1 > backgroundCap) break
    backgroundLines.unshift(line)
    used += line.length + 1
  }
  const synopsis = clipStart(flatten(input.chapterSynopsis), Math.floor(base.inputChars * 0.1))

  const storySide = [
    backgroundLines.length ? `Summaries of earlier sections (oldest first):\n${backgroundLines.join('\n')}` : '',
    synopsis ? `Chapter synopsis:\n${synopsis}` : '',
    `Section to summarize:\n"""\n${input.sectionText}\n"""`,
  ].filter(Boolean).join('\n\n')

  const budget = loreSelectorBudget(input.numCtx, storySide.length, summaryPickSystem.length)
  const list = listContextItems(input.items, budget.loreEntriesChars)
  return {
    outputTokens: budget.outputTokens,
    messages: [
      { role: 'system', content: summaryPickSystem },
      {
        role: 'user',
        content: `${storySide}\n\nNumbered setup entries:\n${list}\n\nReturn the numbers of the entries needed to identify who and what the section involves.`,
      },
    ],
  }
}

const MIN_ENTRY_TEXT_CHARS = 60

export type SummaryReferenceInput = {
  entries: ContextItem[]
  chapterSynopsis: string
  maxChars: number
}

// The lines of the REFERENCE block: the chapter synopsis for orientation, then each picked entry
// with its details clipped evenly. If the entries cannot each keep a useful amount of text, the
// later ones are dropped rather than every entry being cut to nothing.
export function formatSummaryReference(input: SummaryReferenceInput): string[] {
  const lines: string[] = []
  let remaining = input.maxChars
  const synopsis = flatten(input.chapterSynopsis)
  if (synopsis && remaining > 80) {
    const line = `Chapter synopsis: ${clipStart(synopsis, Math.floor(input.maxChars * 0.25))}`
    lines.push(line)
    remaining -= line.length + 1
  }

  const labels = input.entries.map(entry => `- ${contextGroupNames[entry.group]} · ${flatten(entry.label)}: `)
  let count = input.entries.length
  let perEntry = 0
  while (count > 0) {
    // Each line also costs a newline and, when clipped, a trailing ellipsis.
    const fixed = labels.slice(0, count).reduce((total, label) => total + label.length + 2, 0)
    perEntry = Math.floor((remaining - fixed) / count)
    if (perEntry >= MIN_ENTRY_TEXT_CHARS) break
    count--
  }
  for (let index = 0; index < count; index++) {
    const text = contextItemText(input.entries[index]!)
    const excerpt = text.slice(0, perEntry)
    lines.push(`${labels[index]}${excerpt}${excerpt.length < text.length ? '…' : ''}`)
  }
  return lines
}
