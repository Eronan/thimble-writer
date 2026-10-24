import type { StorySectionSummary } from '~/utils/storySections'
import type { StoryFeedback } from '~/utils/storyFeedback'
import type { LoreNote } from '~/utils/loreWorkspace'

export type PromptMode = 'instruct' | 'continue'

export type StoryChapter = {
  id: string
  title: string
  synopsis: string
  story: string
  summaries: StorySectionSummary[]
  feedback: StoryFeedback[]
  feedbackRevisions: FeedbackRevision[]
}

export type Draft = {
  schemaVersion: number
  synopsis: string
  guidance: string
  characters: LoreNote[]
  setting: LoreNote[]
  chapters: StoryChapter[]
  activeChapterId: string
  structurePrompt: string
  prompt: string
  model: string
  mode: PromptMode
  temperature: number
  maxTokens: number
  numCtx: number
  repeatPenalty: number
  writerParagraphs: number
  sectionParagraphs: number
}

export type FeedbackRevision = {
  id: string
  instruction: string
  before: string
  after: string
  appliedAt: number
}
