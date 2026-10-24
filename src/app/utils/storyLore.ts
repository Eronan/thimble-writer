export type LoreEntry = {
  number: number
  text: string
}

export type PreparedLoreEntries = {
  entries: LoreEntry[]
  text: string
}

export const loreSelectionSystem = [
  'You select relevant established lore for a fiction co-writer.',
  'Use the story summaries and writing direction only to judge relevance; do not treat them as lore.',
  'Review every numbered lore entry. Some entry text may be clipped, but every entry number is included.',
  'Return only a JSON object with an entries array containing the numbers of relevant lore entries, ordered most relevant first.',
  'Do not invent lore or include any story events. Return an empty array if no lore is relevant.',
].join(' ')

export const loreSelectionResponseFormat = {
  type: 'object',
  properties: {
    entries: { type: 'array', items: { type: 'integer' } },
  },
  required: ['entries'],
  additionalProperties: false,
} satisfies Record<string, unknown>

export function splitLoreEntries(lore: string): LoreEntry[] {
  return lore
    .split(/\n[ \t]*\n+/)
    .map(text => text.trim())
    .filter(Boolean)
    .map((text, index) => ({ number: index + 1, text }))
}

export function prepareLoreEntries(lore: string, maxChars: number): PreparedLoreEntries {
  if (!Number.isInteger(maxChars) || maxChars < 0) {
    throw new RangeError('Lore selector budget must be a non-negative integer.')
  }
  const entries = splitLoreEntries(lore)
  if (!entries.length) return { entries, text: '' }
  const labels = entries.map(entry => `[${entry.number}] `)
  const fixedChars = labels.reduce((total, label) => total + label.length, 0)
    + Math.max(0, entries.length - 1) * 1
  const clippingMarkerLength = ' [clipped]'.length
  const contentBudget = maxChars - fixedChars - entries.length * clippingMarkerLength
  const perEntryLimit = Math.floor(contentBudget / entries.length)
  if (perEntryLimit < 1) {
    throw new RangeError('The context is too small to send every lore entry to the selector.')
  }

  return {
    entries,
    text: entries.map((entry, index) => {
      const label = labels[index]
      if (!label) throw new RangeError('Could not label a lore entry.')
      const excerpt = entry.text.slice(0, perEntryLimit)
      const clipped = excerpt.length < entry.text.length
      return `${label}${excerpt}${clipped ? ' [clipped]' : ''}`
    }).join('\n'),
  }
}

export function parseLoreSelectionResponse(response: string, entries: LoreEntry[]): number[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(response)
  } catch {
    throw new Error('Ollama returned invalid structured lore-selection data.')
  }
  if (
    !parsed
    || typeof parsed !== 'object'
    || !('entries' in parsed)
    || !Array.isArray(parsed.entries)
    || !parsed.entries.every(number => Number.isInteger(number))
  ) {
    throw new Error('Ollama returned a lore selection without a valid entries list.')
  }
  const validNumbers = new Set(entries.map(entry => entry.number))
  return [...new Set(parsed.entries as number[])].filter(number => validNumbers.has(number))
}

export function fitLoreEntries(
  entries: LoreEntry[],
  selectedNumbers: number[],
  maxChars: number,
): { text: string; omitted: number } {
  if (!Number.isInteger(maxChars) || maxChars < 0) {
    throw new RangeError('Lore context budget must be a non-negative integer.')
  }
  const byNumber = new Map(entries.map(entry => [entry.number, entry]))
  const selected = [...new Set(selectedNumbers)]
    .map(number => byNumber.get(number))
    .filter((entry): entry is LoreEntry => entry !== undefined)
  const included: LoreEntry[] = []
  let usedChars = 0
  for (const entry of selected) {
    const addition = entry.text.length + (included.length ? 2 : 0)
    if (usedChars + addition > maxChars) continue
    included.push(entry)
    usedChars += addition
  }
  return {
    text: included.map(entry => entry.text).join('\n\n'),
    omitted: selected.length - included.length,
  }
}
