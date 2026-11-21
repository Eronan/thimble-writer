import { ollamaRequestOptions, type OllamaChatMessage, type OllamaRequestOptions, type OllamaSettings } from '../clients/ollamaClient.ts'
import { summarySystem } from './storySummary.ts'
import { locateSection, paragraphsWithOffsets, type StoryParagraph, type StorySectionSummary } from './storySections.ts'
import {
  charsForContextBudget,
  LORE_BUDGET_SHARE,
  STORY_TEXT_BUDGET_SHARE,
  STORY_CONTEXT_RESERVE_TOKENS,
  STORY_PROMPT_RESERVE_CHARS,
} from './contextBudget.ts'


export type StoryPromptMode = 'instruct' | 'continue'

export type StoryContextInput = {
  lore: string
  chapterSynopsis: string
  prompt: string
  story: string
  summaries: StorySectionSummary[]
  maxTokens: number
  numCtx: number
  writerParagraphs: number
}

export type StoryContext = {
  lore: string
  loreBudget: number
  summaries: string
  story: string
  chapterSynopsis: string
  continueCurrentParagraph: boolean
  budget: {
    inputChars: number
    storyLimitChars: number
    storyChars: number
    loreLimitChars: number
    summaryChars: number
    chapterSynopsisChars: number
    storyParagraphs: number
    summarySections: number
    summarySectionsOmitted: number
  }
}

type StoryRequestInput = OllamaSettings & {
  mode: StoryPromptMode
  prompt: string
  story: string
}

export type StoryRequest =
  | { kind: 'generate'; prompt: string; options: OllamaRequestOptions }
  | { kind: 'chat'; messages: OllamaChatMessage[]; options: OllamaRequestOptions }

export function buildStoryContext(input: StoryContextInput): StoryContext {
  // Reserve room for the requested output and summary instructions so long drafts do not crowd
  // out the model's ability to finish a useful response.
  const inputChars = charsForContextBudget(
    input.numCtx,
    input.maxTokens,
    STORY_CONTEXT_RESERVE_TOKENS,
  )
  const prompt = input.prompt.trim()
  const chapterSynopsis = input.chapterSynopsis.trim()
  const fixedChars = prompt.length + chapterSynopsis.length + summarySystem.length + STORY_PROMPT_RESERVE_CHARS
  const availableChars = Math.max(0, inputChars - fixedChars)
  const storyLimitChars = Math.floor(availableChars * STORY_TEXT_BUDGET_SHARE)

  const story = input.story
  const paragraphs = paragraphsWithOffsets(story)
  const recentParagraphCount = Math.max(1, Math.floor(input.writerParagraphs) || 3)

  // Verbatim prose is chosen by paragraph index. `override` holds the one case where a single
  // enormous paragraph has to be clipped from its front to fit.
  const kept = new Set<number>()
  const override = new Map<number, string>()
  let storyChars = 0
  const separatorChars = 2

  // 1. Minimum recent prose. The newest N paragraphs always go in verbatim (budget permitting),
  //    whether or not a summary exists for them: they carry the exact voice and the immediate
  //    scene. Math.max keeps this correct when the story has fewer than N paragraphs.
  const windowStart = Math.max(0, paragraphs.length - recentParagraphCount)
  let oldestKept = paragraphs.length
  for (let index = paragraphs.length - 1; index >= windowStart; index--) {
    const paragraph = paragraphs[index]
    if (!paragraph) continue
    const additional = paragraph.text.length + (kept.size ? separatorChars : 0)
    if (storyChars + additional <= storyLimitChars) {
      kept.add(index)
      storyChars += additional
      oldestKept = index
      continue
    }
    // Always pass something from the final paragraph: a clipped tail beats losing the scene.
    if (!kept.size && storyLimitChars > 0) {
      override.set(index, paragraph.text.slice(-storyLimitChars))
      kept.add(index)
      storyChars = storyLimitChars
      oldestKept = index
    }
    break
  }

  // Sections only count as "covering" paragraphs when they sit entirely before the verbatim
  // window. A section that straddles the window is dropped, and its older paragraphs become
  // ordinary uncovered prose rather than disappearing from both summaries and text.
  const windowOffset = paragraphs[oldestKept]?.start ?? story.length
  const eligibleSections = input.summaries
    .map(section => ({ section, range: locateSection(story, section) }))
    .filter(entry => entry.section.summary.trim() && entry.range && entry.range.end <= windowOffset)
    // Array order is creation order; a section summarized later can sit earlier in the story.
    .sort((a, b) => a.range!.start - b.range!.start)
  const isCovered = (index: number) => {
    const paragraph = paragraphs[index]
    return Boolean(paragraph) && eligibleSections.some(({ range }) =>
      range && paragraph!.start < range.end && paragraph!.end > range.start,
    )
  }

  // 2. Paragraphs no section covers, newest first, directly extending the window backwards.
  //    Covered paragraphs are skipped (the summary stands in for them). The cursor persists so a
  //    later pass can resume exactly where this one stopped.
  let gapCursor = oldestKept - 1
  const fillUncoveredParagraphs = (limitChars: number) => {
    while (gapCursor >= 0) {
      const paragraph = paragraphs[gapCursor]
      if (!paragraph) { gapCursor--; continue }
      if (isCovered(gapCursor)) { gapCursor--; continue }
      const additional = paragraph.text.length + (kept.size ? separatorChars : 0)
      if (storyChars + additional > limitChars) return
      kept.add(gapCursor)
      storyChars += additional
      gapCursor--
    }
  }
  fillUncoveredParagraphs(storyLimitChars)

  // 3. Lore gets a bounded slice of what is left, but never more than the lore document holds.
  //    The entries themselves are chosen later by the separate selection pass.
  let remainingChars = Math.max(0, availableChars - storyChars)
  const loreBudget = Math.min(
    Math.floor(remainingChars * LORE_BUDGET_SHARE),
    input.lore.length,
  )
  remainingChars -= loreBudget

  // 4. Section summaries fill the rest from the bottom up, so the sections closest to the
  //    verbatim prose win and the oldest history is what gets dropped first.
  const selectedSummaries: string[] = []
  let usedSummaryChars = 0
  for (const { section } of [...eligibleSections].reverse()) {
    const line = `- ${section.summary.trim()}`
    const additional = line.length + (selectedSummaries.length ? 1 : 0)
    if (usedSummaryChars + additional > remainingChars) break
    selectedSummaries.unshift(line)
    usedSummaryChars += additional
  }
  remainingChars -= usedSummaryChars

  // 5. Anything still unused goes back to uncovered raw prose rather than sitting idle.
  fillUncoveredParagraphs(storyChars + remainingChars)

  const storyText = buildStoryText(story, paragraphs, kept, override)
  const summariesText = selectedSummaries.join('\n')

  return {
    lore: '',
    loreBudget,
    summaries: summariesText,
    story: storyText,
    chapterSynopsis,
    continueCurrentParagraph: Boolean(story.trim()) && !/(?:\r\n|\n)[\t ]*$/.test(story),
    budget: {
      inputChars,
      storyLimitChars,
      storyChars: storyText.length,
      loreLimitChars: loreBudget,
      summaryChars: summariesText.length,
      chapterSynopsisChars: chapterSynopsis.length,
      storyParagraphs: kept.size,
      summarySections: selectedSummaries.length,
      summarySectionsOmitted: eligibleSections.length - selectedSummaries.length,
    },
  }
}

// Adjacent kept paragraphs keep their original separators so the model sees the author's
// formatting; paragraphs separated by summarized material are joined with a blank line.
function buildStoryText(
  story: string,
  paragraphs: StoryParagraph[],
  kept: Set<number>,
  override: Map<number, string>,
): string {
  let text = ''
  let previous: StoryParagraph | undefined
  let previousIndex = -2
  for (const index of [...kept].sort((a, b) => a - b)) {
    const paragraph = paragraphs[index]
    if (!paragraph) continue
    const body = override.get(index) ?? paragraph.text
    if (!text) text = body
    else if (previous && index === previousIndex + 1) text += story.slice(previous.end, paragraph.start) + body
    else text += `\n\n${body}`
    previous = paragraph
    previousIndex = index
  }
  return text
}

export function makeStoryRequest(input: StoryRequestInput, context: StoryContext): StoryRequest {
  const options = ollamaRequestOptions(input)
  const system = [
    'You are a fiction co-writer. Continue the story in the same voice and tense.',
    'Write only story text, with no notes, titles, or commentary.',
    context.continueCurrentParagraph
      ? 'Continue directly from the story’s final character and remain in the current paragraph. Do not start a new paragraph.'
      : '',
    context.lore ? `Lore and story facts:\n${context.lore}` : '',
    context.chapterSynopsis ? `Current chapter synopsis:\n${context.chapterSynopsis}` : '',
    // Summaries are memory for older events, not canonical prose to continue or rewrite. Plain
    // labels keep them distinct without requiring the model to produce a structured response.
    context.summaries ? `Story so far (section summaries):\n${context.summaries}` : '',
  ].filter(Boolean).join('\n\n')

  if (input.mode === 'continue') {
    const prompt = [
      context.lore ? `[Lore]\n${context.lore}` : '',
      context.chapterSynopsis ? `[Current chapter synopsis]\n${context.chapterSynopsis}` : '',
      context.summaries ? `[Story memory]\n${context.summaries}` : '',
      input.prompt.trim() ? `[Next prompt: ${input.prompt.trim()}]` : '',
      context.continueCurrentParagraph ? '[Continue on the same line and in the same paragraph.]' : '',
      context.story ? `[Story text kept verbatim]\n${context.story}` : '',
    ].filter(Boolean).join('\n\n')
    return { kind: 'generate', prompt, options }
  }

  const user = [
    context.story ? `Story text kept verbatim:\n${context.story}` : '',
    input.prompt.trim()
      ? context.continueCurrentParagraph
        ? `Continue directly from the final character and stay in the same paragraph, then follow this direction: ${input.prompt.trim()}`
        : `Write the next part of the story. What happens next: ${input.prompt.trim()}`
      : context.continueCurrentParagraph
        ? 'Continue directly from the final character and stay in the same paragraph.'
        : input.story.trim()
          ? 'Continue the story with the next paragraph.'
          : 'Write the opening paragraph of the story.',
  ].filter(Boolean).join('\n\n')

  return {
    kind: 'chat',
    options,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  }
}
