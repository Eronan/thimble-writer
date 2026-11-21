import type { OllamaChatMessage } from '../clients/ollamaClient.ts'
import { locateSection, type StorySectionSummary } from './storySections.ts'

// The summarizer sees two clearly different things: background it may read but must not
// summarize, and the single section it must summarize. Keeping them in separately labelled,
// delimited blocks stops small models from folding earlier events into the new summary.
export const summarySystem = [
  'You write one entry in a story memory log. The user message may contain two parts:',
  'BACKGROUND: summaries of earlier sections, given only so you understand who people are and what has already happened. Never summarize or repeat the background.',
  'SECTION TO SUMMARIZE: the only text you summarize.',
  'Summarize just the section, in one or two concise sentences, in past tense. Name the characters and preserve important events and changes. Reply with only the summary.',
].join('\n')

export function makeSummaryMessages(source: string, backgroundSummaries: string[] = []): OllamaChatMessage[] {
  const background = backgroundSummaries.map(line => line.trim()).filter(Boolean)
  const user = [
    background.length
      ? `BACKGROUND (earlier sections; context only, do not summarize):\n${background.join('\n')}`
      : '',
    `SECTION TO SUMMARIZE:\n"""\n${source}\n"""`,
    'Write the summary of the SECTION TO SUMMARIZE only.',
  ].filter(Boolean).join('\n\n')
  return [{ role: 'system', content: summarySystem }, { role: 'user', content: user }]
}

// Background for a section is the summaries of sections that end before it starts, in story
// order, keeping the nearest ones when space is short. Position comes from locating each
// section in the story rather than from array order, because summaries can be added out of
// order (for example after one is removed and later regenerated).
export function selectSummaryContext(
  story: string,
  summaries: StorySectionSummary[],
  beforeOffset: number,
  maxChars: number,
): string[] {
  const earlier = summaries
    .map(section => ({ text: section.summary.trim(), range: locateSection(story, section) }))
    .filter(entry => entry.text && entry.range && entry.range.end <= beforeOffset)
    .sort((a, b) => a.range!.start - b.range!.start)

  const picked: string[] = []
  let used = 0
  for (let index = earlier.length - 1; index >= 0; index--) {
    const line = `- ${earlier[index]!.text}`
    const additional = line.length + (picked.length ? 1 : 0)
    if (used + additional > maxChars) break
    picked.unshift(line)
    used += additional
  }
  return picked
}
