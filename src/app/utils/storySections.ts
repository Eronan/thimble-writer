export type StorySectionSummary = {
  id: string
  source: string
  summary: string
}

export type StoryParagraph = {
  text: string
  start: number
  end: number
}

const sceneBreak = /^\s*(\*{3,}|-{3,}|#{3})\s*$/

// Memory follows paragraph/scene boundaries so summaries describe coherent story units. The
// newest writer window stays raw because the next passage needs exact immediate continuity.
export function paragraphsWithOffsets(story: string): StoryParagraph[] {
  const paragraphs: StoryParagraph[] = []
  const expression = /\S[\s\S]*?(?=\n\s*\n|$)/g
  let match: RegExpExecArray | null
  while ((match = expression.exec(story))) {
    paragraphs.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return paragraphs
}

export function locateSection(story: string, section: StorySectionSummary) {
  if (!section.source) return null
  const exact = story.indexOf(section.source)
  if (exact !== -1) return { start: exact, end: exact + section.source.length, stale: false }

  // Keep a summary attached after edits within its section, while requiring both edge anchors so
  // reused character names or phrases cannot make memory point at an unrelated scene.
  const sourceParagraphs = paragraphsWithOffsets(section.source)
  if (sourceParagraphs.length < 2) return null
  const startAnchor = sourceParagraphs[0]?.text.slice(0, 40) ?? ''
  const endAnchor = sourceParagraphs.at(-1)?.text.slice(-40) ?? ''
  if (!startAnchor || !endAnchor) return null
  const start = story.indexOf(startAnchor)
  if (start !== -1) {
    const end = story.indexOf(endAnchor, start + startAnchor.length)
    if (end !== -1) return { start, end: end + endAnchor.length, stale: true }
  }
  return null
}

export function planStorySections(
  story: string,
  summaries: StorySectionSummary[],
  recentParagraphCount: number,
  paragraphsPerSection: number,
  flush = false,
  maxSourceChars = Infinity,
): string[] {
  const paragraphs = paragraphsWithOffsets(story)
  const covered = new Set<number>()
  for (const section of summaries) {
    if (!section.summary.trim()) continue
    const range = locateSection(story, section)
    if (range) {
      paragraphs.forEach((paragraph, index) => {
        if (paragraph.start < range.end && paragraph.end > range.start) covered.add(index)
      })
    }
  }

  const recentCount = Math.max(1, Math.floor(recentParagraphCount) || 1)
  const sectionSize = Math.max(1, Math.floor(paragraphsPerSection) || 1)
  const eligibleCount = Math.max(0, paragraphs.length - recentCount)
  const sections: string[] = []
  let run: StoryParagraph[] = []

  const addRun = () => {
    if (run.length) {
      sections.push(story.slice(run[0].start, run[run.length - 1].end))
      run = []
    }
  }

  for (let index = 0; index < eligibleCount; index++) {
    const paragraph = paragraphs[index]
    if (covered.has(index)) {
      addRun()
      continue
    }
    // Keep scene transitions visible to the model; summarizing a divider into adjacent prose
    // would blur the boundary between story sections.
    if (sceneBreak.test(paragraph.text)) {
      addRun()
      continue
    }
    // Cap source length as well as paragraph count so a single long section cannot crowd out the
    // summarizer's instructions or exceed the configured model context.
    if (run.length && paragraph.end - run[0].start > maxSourceChars) addRun()
    run.push(paragraph)
    if (run.length >= sectionSize) addRun()
  }

  if (flush) addRun()
  return sections
}
