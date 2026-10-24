import { ollamaRequestOptions, type OllamaChatMessage, type OllamaRequestOptions, type OllamaSettings } from '../clients/ollamaClient.ts'
import { locateSection, paragraphsWithOffsets, type StorySectionSummary } from './storySections.ts'
import {
  charsForContextBudget,
  LORE_BUDGET_SHARE,
  STORY_TEXT_BUDGET_SHARE,
  STORY_CONTEXT_RESERVE_TOKENS,
  STORY_PROMPT_RESERVE_CHARS,
} from './contextBudget.ts'

export const summarySystem = 'Summarize this story section in one or two concise sentences, in past tense. Name the characters and preserve important events and changes. Reply with only the summary.'

export type StoryPromptMode = 'instruct' | 'continue'

export type StoryContextInput = {
  lore: string
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
  continueCurrentParagraph: boolean
  budget: {
    inputChars: number
    storyLimitChars: number
    storyChars: number
    loreLimitChars: number
    summaryChars: number
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
  let remainingChars = inputChars
  const prompt = input.prompt.trim()
  const paragraphs = paragraphsWithOffsets(input.story)
  const recentParagraphCount = Math.max(1, Math.floor(input.writerParagraphs) || 3)
  const recentStart = paragraphs.at(-recentParagraphCount)?.start ?? input.story.length
  // Older events are represented by their latest summaries, while recent prose stays verbatim
  // because it supplies the exact voice and immediate continuity for the next passage.
  const validSummaries = input.summaries
    .map(section => ({ section, range: locateSection(input.story, section) }))
    .filter(entry => entry.section.summary.trim() && entry.range && entry.range.end <= recentStart)
  const uncompressedParagraphs = paragraphs.filter(paragraph =>
    !validSummaries.some(({ range }) => range && paragraph.start < range.end && paragraph.end > range.start),
  )
  const uncompressedTextLength = uncompressedParagraphs.reduce((length, paragraph) => length + paragraph.text.length + 2, 0)
  const fixedChars = prompt.length + summarySystem.length + STORY_PROMPT_RESERVE_CHARS
  remainingChars = Math.max(0, remainingChars - fixedChars)
  const storyBudget = Math.min(uncompressedTextLength, Math.floor(remainingChars * STORY_TEXT_BUDGET_SHARE))
  let storyTail = ''
  let usedStoryChars = 0

  for (let index = uncompressedParagraphs.length - 1; index >= 0; index--) {
    const entry = uncompressedParagraphs[index]
    if (!entry) continue
    const paragraph = entry.text
    const additionalChars = paragraph.length + (storyTail ? 2 : 0)
    if (usedStoryChars + additionalChars <= storyBudget) {
      storyTail = storyTail ? `${paragraph}\n\n${storyTail}` : paragraph
      usedStoryChars += additionalChars
      continue
    }
    if (!storyTail && storyBudget > 0) {
      storyTail = paragraph.slice(-storyBudget)
      usedStoryChars = storyTail.length
    }
    break
  }
  remainingChars -= usedStoryChars

  // Smaller models cannot reliably use a full lore document; reserve a bounded slice for relevant
  // world facts rather than letting lore displace the current story and its accumulated memory.
  // The actual lore is selected by the separate entry-selection pass before generation.
  const loreBudget = Math.floor(remainingChars * LORE_BUDGET_SHARE)
  remainingChars -= loreBudget

  const selectedSummaries: string[] = []
  let usedSummaryChars = 0
  for (const { section } of [...validSummaries].reverse()) {
    const line = `- ${section.summary.trim()}`
    if (!section.summary.trim()) continue
    if (usedSummaryChars + line.length > remainingChars) break
    selectedSummaries.unshift(line)
    usedSummaryChars += line.length
  }

  return {
    lore: '',
    loreBudget,
    summaries: selectedSummaries.join('\n'),
    story: storyTail,
    continueCurrentParagraph: Boolean(input.story.trim()) && !/(?:\r\n|\n)[\t ]*$/.test(input.story),
    budget: {
      inputChars,
      storyLimitChars: storyBudget,
      storyChars: storyTail.length,
      loreLimitChars: loreBudget,
      summaryChars: selectedSummaries.join('\n').length,
    },
  }
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
    // Summaries are memory for older events, not canonical prose to continue or rewrite. Plain
    // labels keep them distinct without requiring the model to produce a structured response.
    context.summaries ? `Story so far (section summaries):\n${context.summaries}` : '',
  ].filter(Boolean).join('\n\n')

  if (input.mode === 'continue') {
    const prompt = [
      context.lore ? `[Lore]\n${context.lore}` : '',
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
