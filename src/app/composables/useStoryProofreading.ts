import { ref, type Ref } from 'vue'
import { ollamaClient, ollamaRequestOptions } from '~/clients/ollamaClient'
import type { Draft, StoryChapter } from '~/types/storyWriter'
import { locateFeedback, type StoryFeedback } from '~/utils/storyFeedback'
import {
  anchorProofreadSuggestions,
  parseProofreadResponse,
  proofreadResponseFormat,
  splitStoryForProofreading,
  type AnchoredProofreadSuggestion,
} from '~/utils/storyProofread'
import { proofreadingBudget } from '~/utils/contextBudget'

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
      let skipped = 0
      let truncatedResponses = 0
      for (const [index, chunk] of chunks.entries()) {
        status.value = chunks.length > 1
          ? `Proofreading section ${index + 1} of ${chunks.length}…`
          : 'Proofreading story…'
        const response = await ollamaClient.chat({
          model: draft.model,
          options: ollamaRequestOptions(draft, {
            temperature: Math.min(draft.temperature, 0.2),
            maxTokens: budget.outputTokens,
            repeatPenalty: null,
          }),
          format: proofreadResponseFormat,
          messages: [
            {
              role: 'system',
              content: [
                'You are a careful fiction proofreader. Identify only clear spelling, grammar, punctuation, or wording errors; do not rewrite for subjective style preferences.',
                'Return a structured comments list. Each quote must be an exact, contiguous passage from the story and should be as short as possible while identifying the issue.',
                'The before and after fields must be exact adjacent text immediately before and after the quote, each no longer than 80 characters. Use them to disambiguate repeated quotes.',
                'The story summaries are context only. Do not proofread them or return comments about them.',
                'Return at most three comments for this passage. Focus on the clearest, most important errors.',
                'Keep issue and suggestion brief, with a suggested correction of no more than 20 words. Do not change the story yourself.',
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
        const parsed = parseProofreadResponse(response)
        if (parsed.incomplete) truncatedResponses++
        skipped += parsed.skipped
        const anchored = anchorProofreadSuggestions(chunk, parsed.comments)
        suggestions.push(...anchored.comments)
        skipped += anchored.skipped
      }

      const occupied = chapter.value.feedback
        .map(comment => locateFeedback(storySnapshot, comment))
        .filter((range): range is NonNullable<typeof range> => range !== null)
      if (chapter.value.story !== storySnapshot) {
        throw new Error('The story changed during proofreading. No comments were added; run proofreading again.')
      }
      let added = 0
      for (const suggestion of suggestions) {
        const overlaps = occupied.some(range => suggestion.start < range.end && suggestion.end > range.start)
        if (overlaps) {
          skipped++
          continue
        }
        const comment: StoryFeedback = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          start: suggestion.start,
          source: suggestion.quote,
          before: storySnapshot.slice(Math.max(0, suggestion.start - 80), suggestion.start),
          after: storySnapshot.slice(suggestion.end, suggestion.end + 80),
          instruction: `${suggestion.issue} Suggested correction: ${suggestion.suggestion}`,
        }
        // Keep proofreading suggestions reviewable so writers choose which changes to apply.
        chapter.value.feedback.push(comment)
        occupied.push({ start: suggestion.start, end: suggestion.end })
        added++
      }
      const incompleteNotice = truncatedResponses
        ? `; recovered complete comments from ${truncatedResponses} truncated response${truncatedResponses === 1 ? '' : 's'}`
        : ''
      status.value = added
        ? `Proofreading added ${added} comment${added === 1 ? '' : 's'}${skipped ? `; skipped ${skipped} unanchored or overlapping suggestion${skipped === 1 ? '' : 's'}` : ''}${incompleteNotice}`
        : skipped
          ? `No comments added; skipped ${skipped} suggestion${skipped === 1 ? '' : 's'} that could not be safely anchored${incompleteNotice}`
          : truncatedResponses
            ? `Proofreading response was truncated and contained no complete comments${incompleteNotice}`
            : 'Proofreading found no clear issues'
    } catch (cause) {
      error.value = cause instanceof Error ? `Proofreading failed: ${cause.message}` : 'Proofreading failed.'
      status.value = ''
    } finally {
      proofreading.value = false
    }
  }

  return { proofreading, proofreadStory }
}
