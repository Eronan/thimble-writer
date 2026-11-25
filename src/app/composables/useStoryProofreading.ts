import { ref, type Ref } from 'vue'
import { ollamaClient, ollamaRequestOptions } from '~/clients/ollamaClient'
import type { Draft, StoryChapter } from '~/types/storyWriter'
import { locateFeedback, type StoryFeedback } from '~/utils/storyFeedback'
import {
  anchorProofreadSuggestions,
  describeProofreadOutcome,
  parseProofreadResponse,
  proofreadResponseFormat,
  splitStoryForProofreading,
  type AnchoredProofreadSuggestion,
} from '~/utils/storyProofread'
import { proofreadingBudget } from '~/utils/contextBudget'
import { checkFixReplacement } from '~/utils/storyFixes'

type StoryProofreadingOptions = {
  draft: Draft
  chapter: Readonly<Ref<StoryChapter>>
  generating: Ref<boolean>
  summarizing: Ref<boolean>
  revisingFeedback: Ref<boolean>
  error: Ref<string>
  status: Ref<string>
}

export function useStoryProofreading(options: StoryProofreadingOptions) {
  const proofreading = ref(false)
  const { draft, chapter, generating, summarizing, revisingFeedback, error, status } = options

  async function proofreadStory() {
    if (proofreading.value || generating.value || summarizing.value || revisingFeedback.value) return
    if (!draft.model) {
      error.value = 'Choose an Ollama model before proofreading.'
      return
    }
    if (!chapter.value.story.trim()) {
      status.value = 'Write some story text before proofreading.'
      return
    }
    const budget = proofreadingBudget(draft.numCtx, draft.maxTokens)
    if (budget.inputChars < 1) {
      error.value = 'The context size is too small for proofreading with the current output limit.'
      return
    }

    proofreading.value = true
    error.value = ''
    status.value = 'Preparing story for proofreading…'
    try {
      const storySnapshot = chapter.value.story
      const chunks = splitStoryForProofreading(storySnapshot, budget.chunkChars, chapter.value.summaries)
      const suggestions: AnchoredProofreadSuggestion[] = []
      let suggested = 0
      let malformed = 0
      let unanchored = 0
      let truncatedResponses = 0
      for (const [index, chunk] of chunks.entries()) {
        status.value = chunks.length > 1
          ? `Proofreading section ${index + 1} of ${chunks.length}…`
          : 'Proofreading story…'
        const parsed = await ollamaClient.chat({
          label: 'Proofread',
          model: draft.model,
          options: ollamaRequestOptions(draft, {
            temperature: Math.min(draft.temperature, 0.2),
            maxTokens: budget.outputTokens,
            repeatPenalty: null,
          }),
          format: proofreadResponseFormat,
          parse: parseProofreadResponse,
          messages: [
            {
              role: 'system',
              content: [
                'You are a careful fiction proofreader. Identify only clear spelling, grammar, punctuation, tense, or wording errors; do not rewrite for subjective style preferences.',
                'Return a structured comments list. Each item has a quote, an issue, and a replacement.',
                'quote is the smallest exact, contiguous passage from the story that must change: a single word for a spelling error, a clause or sentence only when the fix needs it. It must appear exactly once in the passage; if the same words repeat, lengthen the quote until it is unique.',
                'replacement is the exact text that will be pasted in place of quote, and nothing else. It is the corrected version of the quote itself, with the same wording, punctuation style, and voice except for what the issue requires. Never include text from before or after the quote, and never add new sentences.',
                'issue is a brief reason, under 12 words.',
                'The story summaries are context only. Do not proofread them or return comments about them.',
                'Return at most three comments for this passage. Focus on the clearest, most important errors. Do not change the story yourself.',
              ].join(' '),
            },
            {
              role: 'user',
              content: [
                chunk.summaries.length
                  ? `Relevant story summaries (context only):\n${chunk.summaries.map(summary => `- ${summary}`).join('\n')}`
                  : '',
                `Proofread only this story passage:\n\n${chunk.text}`,
              ].filter(Boolean).join('\n\n'),
            },
          ],
        })
        if (parsed.incomplete) truncatedResponses++
        suggested += parsed.comments.length + parsed.skipped
        malformed += parsed.skipped
        const anchored = anchorProofreadSuggestions(chunk, parsed.comments)
        suggestions.push(...anchored.comments)
        unanchored += anchored.skipped
      }

      const occupied = chapter.value.feedback
        .map(comment => locateFeedback(storySnapshot, comment))
        .filter((range): range is NonNullable<typeof range> => range !== null)
      if (chapter.value.story !== storySnapshot) {
        throw new Error('The story changed during proofreading. No comments were added; run proofreading again.')
      }
      let added = 0
      let overlapping = 0
      let unsafe = 0
      for (const suggestion of suggestions) {
        if (occupied.some(range => suggestion.start < range.end && suggestion.end > range.start)) {
          overlapping++
          continue
        }
        // Fixes are pasted in without a model reviewing them, so only keep corrections that look
        // like a local edit of their quote (not a rewrite, new paragraph, or duplicated text).
        if (checkFixReplacement(suggestion.quote, suggestion.replacement)) {
          unsafe++
          continue
        }
        const comment: StoryFeedback = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          start: suggestion.start,
          source: suggestion.quote,
          before: storySnapshot.slice(Math.max(0, suggestion.start - 80), suggestion.start),
          after: storySnapshot.slice(suggestion.end, suggestion.end + 80),
          instruction: suggestion.issue,
          kind: 'fix',
          replacement: suggestion.replacement,
        }
        // Keep proofreading suggestions reviewable so writers choose which changes to apply.
        chapter.value.feedback.push(comment)
        occupied.push({ start: suggestion.start, end: suggestion.end })
        added++
      }
      status.value = describeProofreadOutcome({
        added,
        suggested,
        malformed,
        unanchored,
        overlapping,
        unsafe,
        truncatedResponses,
      })
    } catch (cause) {
      error.value = cause instanceof Error ? `Proofreading failed: ${cause.message}` : 'Proofreading failed.'
      status.value = ''
    } finally {
      proofreading.value = false
    }
  }

  return { proofreading, proofreadStory }
}
