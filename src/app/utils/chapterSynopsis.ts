import type { StoryChapter } from '~/types/storyWriter'

export type GeneratedChapterStructure = {
  title: string
  synopsis: string
}

export const chapterStructureResponseFormat = {
  type: 'object',
  properties: {
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          synopsis: { type: 'string' },
        },
        required: ['title', 'synopsis'],
        additionalProperties: false,
      },
    },
  },
  required: ['chapters'],
  additionalProperties: false,
} satisfies Record<string, unknown>

function clipContext(text: string, maxChars: number): { text: string; clipped: boolean } {
  if (text.length <= maxChars) return { text, clipped: false }
  if (maxChars <= 0) return { text: '', clipped: Boolean(text) }
  const marker = '…'
  return { text: `${text.slice(0, Math.max(0, maxChars - marker.length))}${marker}`, clipped: true }
}

export function buildAllChapterStructureContext(
  chapters: StoryChapter[],
  lore: string,
  prompt: string,
  maxChars: number,
) {
  const fixed = 'Develop a coherent story structure for the full story. Preserve the existing chapter order and return one entry for every existing chapter. You may append chapters if the story needs them; do not remove existing chapters. Use Lore as established facts and the prompt as the user’s additional direction. Each chapter synopsis should describe its major events, conflict, turning point, and outcome.'
  const chapterEntries = chapters.map((chapter, index) => ({
    title: `${index + 1}. ${chapter.title.trim() || `Chapter ${index + 1}`}:`,
    synopsis: chapter.synopsis.trim(),
  }))
  const overhead = fixed.length + '\n\nChapters:\n'.length + '\n\nLore:\n'.length + '\n\nAdditional direction:\n'.length
    + chapterEntries.reduce((total, entry) => total + entry.title.length + 1, 0)
  const contentBudget = Math.max(0, maxChars - overhead)
  const promptBudget = Math.floor(contentBudget * 0.25)
  const loreBudget = Math.floor(contentBudget * 0.25)
  const chaptersBudget = contentBudget - promptBudget - loreBudget
  const perSynopsisBudget = chapterEntries.length
    ? Math.floor(chaptersBudget / chapterEntries.length)
    : 0
  const fittedChapters = chapterEntries
    .map(entry => `${entry.title}\n${clipContext(entry.synopsis, perSynopsisBudget).text}`)
    .join('\n\n')
  const fittedPrompt = clipContext(prompt.trim(), promptBudget)
  const fittedLore = clipContext(lore.trim(), loreBudget)
  const context = [
    fixed,
    `Chapters:\n${fittedChapters}`,
    fittedLore.text ? `Lore:\n${fittedLore.text}` : '',
    fittedPrompt.text ? `Additional direction:\n${fittedPrompt.text}` : '',
  ].filter(Boolean).join('\n\n')
  return {
    context: clipContext(context, maxChars).text,
    clipped: fittedPrompt.clipped || fittedLore.clipped
      || chapterEntries.some(entry => entry.synopsis.length > perSynopsisBudget)
      || context.length > maxChars,
  }
}

export function parseChapterStructureResponse(
  response: string,
  minimumChapters: number,
): GeneratedChapterStructure[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(response.replace(/^\uFEFF/, '').trim()) as unknown
  } catch {
    throw new Error('Ollama returned invalid structured chapter data.')
  }
  if (
    typeof parsed !== 'object'
    || parsed === null
    || !('chapters' in parsed)
    || !Array.isArray(parsed.chapters)
    || parsed.chapters.length < minimumChapters
  ) {
    throw new Error('Ollama returned structured chapter data without all existing chapters.')
  }
  return parsed.chapters.map((chapter) => {
    if (
      typeof chapter !== 'object'
      || chapter === null
      || !('title' in chapter)
      || typeof chapter.title !== 'string'
      || !('synopsis' in chapter)
      || typeof chapter.synopsis !== 'string'
      || !chapter.title.trim()
      || !chapter.synopsis.trim()
    ) {
      throw new Error('Ollama returned invalid structured chapter data.')
    }
    return { title: chapter.title.trim(), synopsis: chapter.synopsis.trim() }
  })
}

export function buildChapterSynopsisContext(
  target: StoryChapter,
  chapters: StoryChapter[],
  lore: string,
  maxChars: number,
  prompt = '',
) {
  const otherSynopses = chapters
    .filter(chapter => chapter.id !== target.id && chapter.synopsis.trim())
    .map(chapter => `${chapter.title.trim() || 'Untitled chapter'}:\n${chapter.synopsis.trim()}`)
    .join('\n\n')
  const fixed = `Create a story structure for "${target.title.trim() || 'Untitled chapter'}".\n\n`
    + 'Use the other chapter synopses for continuity and the lore as established facts. Do not copy an earlier synopsis or invent details that contradict the lore. Include the opening situation, major events in order, central conflict, turning point or climax, and outcome or transition.'
  if (maxChars <= fixed.length) {
    return { context: clipContext(fixed, maxChars).text, clipped: true }
  }
  const available = Math.max(0, maxChars - fixed.length - 80)
  const promptLimit = Math.floor(available * 0.2)
  const synopsisLimit = Math.floor((available - promptLimit) * 0.65)
  const loreLimit = available - promptLimit - synopsisLimit
  const fittedSynopses = clipContext(otherSynopses, synopsisLimit)
  const fittedLore = clipContext(lore.trim(), loreLimit)
  const fittedPrompt = clipContext(prompt.trim(), promptLimit)
  const context = [
    fixed,
    fittedSynopses.text ? `Other chapter synopses:\n${fittedSynopses.text}` : '',
    fittedLore.text ? `Lore:\n${fittedLore.text}` : '',
    fittedPrompt.text ? `Additional direction:\n${fittedPrompt.text}` : '',
  ].filter(Boolean).join('\n\n')
  return {
    context,
    clipped: fittedSynopses.clipped || fittedLore.clipped || fittedPrompt.clipped,
  }
}
