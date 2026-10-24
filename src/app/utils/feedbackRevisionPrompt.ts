import { fitLoreEntries, splitLoreEntries } from './storyLore.ts'
import { feedbackContextAllocation } from './contextBudget.ts'

export type FeedbackRevisionContextInput = {
  system: string
  lore: string
  summaries: string[]
  surroundingBefore: string
  surroundingAfter: string
  selectedPassage: string
  instruction: string
  maxChars: number
}

function fitNearbyText(before: string, after: string, maxChars: number): { before: string; after: string } {
  let beforeLength = Math.min(before.length, Math.floor(maxChars / 2))
  let afterLength = Math.min(after.length, maxChars - beforeLength)
  beforeLength = Math.min(before.length, maxChars - afterLength)
  return {
    before: beforeLength ? before.slice(-beforeLength) : '',
    after: after.slice(0, afterLength),
  }
}

export function buildFeedbackRevisionContext(input: FeedbackRevisionContextInput): string {
  const labels = {
    lore: 'Relevant lore (context only):\n',
    summaries: 'Relevant section summaries (context only):\n',
    before: 'Nearby story before the selected passage:\n',
    passage: 'Selected passage to replace:\n',
    after: 'Nearby story after the selected passage:\n',
    instruction: 'Feedback for this passage:\n',
  }
  const fixedChars = input.system.length
    + labels.lore.length + labels.summaries.length + labels.before.length + labels.passage.length
    + labels.after.length + labels.instruction.length
    + input.selectedPassage.length + input.instruction.length
    + 10
  const availableChars = input.maxChars - fixedChars
  if (availableChars < 0) {
    throw new Error('The selected passage and feedback exceed the available model context. Increase the context size or shorten the selection.')
  }

  const { nearbyChars: nearbyBudget, summaryChars: summaryBudget, loreChars: loreBudget } =
    feedbackContextAllocation(availableChars)
  const nearby = fitNearbyText(input.surroundingBefore, input.surroundingAfter, nearbyBudget)
  const summaries: string[] = []
  let summariesUsed = 0
  for (const summary of [...input.summaries].reverse()) {
    const addition = summary.length + (summaries.length ? 1 : 0)
    if (summariesUsed + addition > summaryBudget) continue
    summaries.unshift(summary)
    summariesUsed += addition
  }
  const loreEntries = splitLoreEntries(input.lore)
  const lore = fitLoreEntries(loreEntries, loreEntries.map(entry => entry.number), loreBudget).text

  return [
    lore ? `${labels.lore}${lore}` : '',
    summaries.length ? `${labels.summaries}${summaries.join('\n')}` : '',
    nearby.before ? `${labels.before}${nearby.before}` : '',
    `${labels.passage}${input.selectedPassage}`,
    nearby.after ? `${labels.after}${nearby.after}` : '',
    `${labels.instruction}${input.instruction}`,
  ].filter(Boolean).join('\n\n')
}
