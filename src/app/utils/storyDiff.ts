import { getFeedbackDiffLines, type FeedbackDiffLinePair } from './storyFeedback.ts'

export type StoryDiffPairType = 'context' | 'changed' | 'added' | 'removed'

export type StoryDiffItem =
  | { kind: 'gap'; count: number }
  | { kind: 'pair'; type: StoryDiffPairType; pair: FeedbackDiffLinePair }

export type StoryDiff = {
  items: StoryDiffItem[]
  identical: boolean
  stats: {
    addedParagraphs: number
    removedParagraphs: number
    changedParagraphs: number
    wordDelta: number
  }
}

export function countWords(text: string) {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

function pairType(pair: FeedbackDiffLinePair): StoryDiffPairType {
  if (pair.before === null) return 'added'
  if (pair.after === null) return 'removed'
  return pair.changed ? 'changed' : 'context'
}

/**
 * Compare two versions of a story paragraph by paragraph. Unchanged paragraphs far from any
 * change are folded into a "gap" so a long chapter shows only what moved, with `context`
 * unchanged paragraphs kept on each side of every change.
 */
export function getStoryDiff(before: string, after: string, context = 1): StoryDiff {
  const pairs = getFeedbackDiffLines(before, after)
  const types = pairs.map(pairType)
  const keep = types.map((type, index) => {
    if (type !== 'context') return true
    for (let offset = -context; offset <= context; offset++) {
      const neighbour = types[index + offset]
      if (neighbour !== undefined && neighbour !== 'context') return true
    }
    return false
  })

  const items: StoryDiffItem[] = []
  let skipped = 0
  pairs.forEach((pair, index) => {
    if (keep[index]) {
      if (skipped) items.push({ kind: 'gap', count: skipped })
      skipped = 0
      items.push({ kind: 'pair', type: types[index]!, pair })
    } else {
      skipped += 1
    }
  })
  if (skipped) items.push({ kind: 'gap', count: skipped })

  return {
    items,
    identical: types.every(type => type === 'context'),
    stats: {
      addedParagraphs: types.filter(type => type === 'added').length,
      removedParagraphs: types.filter(type => type === 'removed').length,
      changedParagraphs: types.filter(type => type === 'changed').length,
      wordDelta: countWords(after) - countWords(before),
    },
  }
}

export function describeWordDelta(delta: number) {
  if (delta === 0) return 'no change in word count'
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} word${Math.abs(delta) === 1 ? '' : 's'}`
}
