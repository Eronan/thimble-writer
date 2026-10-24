import type { StorySectionSummary } from '~/utils/storySections'
import type { StoryFeedback } from '~/utils/storyFeedback'
import type { LoreNote } from '~/utils/loreWorkspace'

export type PromptMode = 'instruct' | 'continue'

export type Draft = {
  schemaVersion: number
  synopsis: string
  guidance: string
  characters: LoreNote[]
  setting: LoreNote[]
  story: string
  summaries: StorySectionSummary[]
  feedback: StoryFeedback[]
  feedbackRevisions: FeedbackRevision[]
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
