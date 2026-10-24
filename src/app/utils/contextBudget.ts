export const CHARS_PER_TOKEN = 3.5
export const SUMMARY_REPLY_TOKENS = 120
export const SUMMARY_CONTEXT_RESERVE_TOKENS = 200
export const STORY_CONTEXT_RESERVE_TOKENS = 180
export const STORY_PROMPT_RESERVE_CHARS = 180
export const PROOFREAD_CONTEXT_RESERVE_TOKENS = 300
export const FEEDBACK_CONTEXT_RESERVE_TOKENS = 250
export const SELECTOR_CONTEXT_RESERVE_TOKENS = 200
export const SELECTOR_OUTPUT_RESERVE_TOKENS = 300
export const SELECTOR_MAX_OUTPUT_TOKENS = 256
export const SELECTOR_PROMPT_RESERVE_CHARS = 180
export const PROOFREAD_CHUNK_LIMIT_CHARS = 2000
export const MIN_SUMMARY_SOURCE_CHARS = 300
export const MIN_PROOFREAD_OUTPUT_TOKENS = 1200
export const PROOFREAD_OUTPUT_HEADROOM_TOKENS = 256
export const CHAPTER_SYNOPSIS_OUTPUT_TOKENS = 500
export const CHAPTER_SYNOPSIS_CONTEXT_RESERVE_TOKENS = 300
export const STORY_TEXT_BUDGET_SHARE = 0.6
export const LORE_BUDGET_SHARE = 0.45
export const FEEDBACK_NEARBY_BUDGET_SHARE = 0.5
export const FEEDBACK_SUMMARY_BUDGET_SHARE = 0.25

export function charsForContextBudget(
  contextTokens: number,
  outputTokens: number,
  reserveTokens: number,
): number {
  return Math.floor(Math.max(0, contextTokens - outputTokens - reserveTokens) * CHARS_PER_TOKEN)
}

export function summarySourceBudget(contextTokens: number): number {
  return Math.max(
    MIN_SUMMARY_SOURCE_CHARS,
    charsForContextBudget(contextTokens, SUMMARY_REPLY_TOKENS, SUMMARY_CONTEXT_RESERVE_TOKENS),
  )
}

export function proofreadingBudget(contextTokens: number, requestedOutputTokens: number) {
  const outputTokens = Math.min(
    Math.max(requestedOutputTokens, MIN_PROOFREAD_OUTPUT_TOKENS),
    Math.max(1, contextTokens - PROOFREAD_OUTPUT_HEADROOM_TOKENS),
  )
  const inputChars = charsForContextBudget(
    contextTokens,
    outputTokens,
    PROOFREAD_CONTEXT_RESERVE_TOKENS,
  )
  return {
    outputTokens,
    inputChars,
    chunkChars: Math.min(PROOFREAD_CHUNK_LIMIT_CHARS, inputChars),
  }
}

export function loreSelectorBudget(
  contextTokens: number,
  selectorContextChars: number,
  systemPromptChars: number,
) {
  const outputTokens = Math.min(
    SELECTOR_MAX_OUTPUT_TOKENS,
    Math.max(1, contextTokens - SELECTOR_OUTPUT_RESERVE_TOKENS),
  )
  const inputChars = charsForContextBudget(
    contextTokens,
    outputTokens,
    SELECTOR_CONTEXT_RESERVE_TOKENS,
  )
  return {
    outputTokens,
    inputChars,
    loreEntriesChars: inputChars
      - systemPromptChars
      - selectorContextChars
      - SELECTOR_PROMPT_RESERVE_CHARS,
  }
}

export function feedbackContextAllocation(availableChars: number) {
  const nearbyChars = Math.floor(availableChars * FEEDBACK_NEARBY_BUDGET_SHARE)
  const summaryChars = Math.floor(availableChars * FEEDBACK_SUMMARY_BUDGET_SHARE)
  return {
    nearbyChars,
    summaryChars,
    loreChars: availableChars - nearbyChars - summaryChars,
  }
}

export function chapterSynopsisBudget(contextTokens: number) {
  const outputTokens = Math.min(
    CHAPTER_SYNOPSIS_OUTPUT_TOKENS,
    Math.max(1, contextTokens - PROOFREAD_OUTPUT_HEADROOM_TOKENS),
  )
  return {
    outputTokens,
    inputChars: charsForContextBudget(
      contextTokens,
      outputTokens,
      CHAPTER_SYNOPSIS_CONTEXT_RESERVE_TOKENS,
    ),
  }
}

export function allChapterStructureBudget(contextTokens: number, chapterCount: number) {
  const inputReserveTokens = Math.min(600, Math.max(1, contextTokens - 1))
  const outputTokens = Math.min(
    Math.max(700, chapterCount * 400),
    Math.max(1, contextTokens - CHAPTER_SYNOPSIS_CONTEXT_RESERVE_TOKENS - inputReserveTokens),
  )
  return {
    outputTokens,
    inputChars: charsForContextBudget(
      contextTokens,
      outputTokens,
      CHAPTER_SYNOPSIS_CONTEXT_RESERVE_TOKENS,
    ),
  }
}
