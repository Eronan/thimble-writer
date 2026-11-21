import { locateFeedback, type StoryFeedback } from './storyFeedback.ts'

export type StoryFix = StoryFeedback & { kind: 'fix'; replacement: string }

export const MAX_FIX_QUOTE_CHARS = 300

// Defensive on purpose: a hand-edited or imported item that says 'fix' but has no replacement
// is treated as an ordinary comment instead of a fix that can never be applied.
export function isFix(comment: StoryFeedback): comment is StoryFix {
  return comment.kind === 'fix' && typeof comment.replacement === 'string'
}

export function splitFeedback(feedback: StoryFeedback[]) {
  return {
    fixes: feedback.filter(isFix),
    comments: feedback.filter(comment => !isFix(comment)),
  }
}

export type FixRejection = 'unchanged' | 'quote-too-long' | 'line-break' | 'size'

// A fix is pasted in without a model reviewing it, so it has to look like a local correction of
// its quote. These checks reject the shapes that previously caused extra or duplicated text: a
// "correction" that is really a longer rewrite, adds paragraphs, or throws most of the quote away.
export function checkFixReplacement(quote: string, replacement: string): FixRejection | null {
  if (replacement === quote) return 'unchanged'
  if (quote.length > MAX_FIX_QUOTE_CHARS) return 'quote-too-long'
  if (!/[\r\n]/.test(quote) && /[\r\n]/.test(replacement)) return 'line-break'
  if (replacement.length > quote.length * 2 + 40) return 'size'
  if (quote.length >= 40 && replacement.length < quote.length * 0.4) return 'size'
  return null
}

export type AppliedFix = { id: string; instruction: string; before: string; after: string }

export type FixApplication = {
  story: string
  applied: AppliedFix[]
  // Fixes whose quoted text is gone (the story changed) or that collide with another fix.
  failed: string[]
}

// Every fix is located against the story as it is now, then spliced from the end backwards so
// earlier replacements cannot shift later ranges. The only text that can enter the story is each
// fix's own `replacement`; nothing else is read or generated.
export function applyFixesToStory(story: string, fixes: StoryFix[]): FixApplication {
  const failed: string[] = []
  const located: Array<{ fix: StoryFix; start: number; end: number }> = []
  for (const fix of fixes) {
    const range = locateFeedback(story, fix)
    if (range) located.push({ fix, start: range.start, end: range.end })
    else failed.push(fix.id)
  }

  located.sort((left, right) => left.start - right.start)
  const usable: typeof located = []
  let previousEnd = -1
  for (const entry of located) {
    if (entry.start < previousEnd) {
      failed.push(entry.fix.id)
      continue
    }
    usable.push(entry)
    previousEnd = entry.end
  }

  let next = story
  for (const { fix, start, end } of [...usable].reverse()) {
    next = `${next.slice(0, start)}${fix.replacement}${next.slice(end)}`
  }
  return {
    story: next,
    applied: usable.map(({ fix }) => ({
      id: fix.id,
      instruction: fix.instruction,
      before: fix.source,
      after: fix.replacement,
    })),
    failed,
  }
}
