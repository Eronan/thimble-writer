import { ref, type Ref } from 'vue'
import { ollamaClient, ollamaRequestOptions } from '~/clients/ollamaClient'
import type { Draft, StoryChapter } from '~/types/storyWriter'
import { planStorySections } from '~/utils/storySections'
import { summarySourceBudget, SUMMARY_REPLY_TOKENS } from '~/utils/contextBudget'
import { summarySystem } from '~/utils/storyPrompt'

type StorySummaryOptions = {
  draft: Draft
  chapter: Readonly<Ref<StoryChapter>>
  generating: Ref<boolean>
  error: Ref<string>
  status: Ref<string>
}

export function useStorySummaries(options: StorySummaryOptions) {
  const summarizing = ref(false)
  const { draft, chapter, generating, error, status } = options

  async function summarizeOlderSections(story = chapter.value.story, flush = true) {
    if (summarizing.value || generating.value) return
    if (!draft.model) {
      error.value = 'Choose an Ollama model before summarizing story sections.'
      return
    }
    summarizing.value = true
    error.value = ''
    try {
      const sourceBudget = summarySourceBudget(draft.numCtx)
      const sources = planStorySections(
        story,
        chapter.value.summaries,
        Math.max(1, Math.floor(draft.writerParagraphs) || 3),
        Math.max(1, Math.floor(draft.sectionParagraphs) || 4),
        flush,
        sourceBudget,
      )
      // Automatic summaries wait for complete sections; manual summarizing flushes eligible prose.
      if (!sources.length) {
        if (flush) status.value = 'No older sections need summarizing yet'
        return
      }
      status.value = 'Summarizing older story sections…'
      let added = 0
      for (const source of sources) {
        if (source.length > sourceBudget) {
          throw new Error('A paragraph is longer than the summarizer context budget. Increase the context size or split that paragraph.')
        }
        const response = await ollamaClient.chat({
          label: 'Section summary',
          model: draft.model,
          options: ollamaRequestOptions(draft, {
            temperature: 0.3,
            maxTokens: SUMMARY_REPLY_TOKENS,
            repeatPenalty: null,
          }),
          messages: [
            { role: 'system', content: summarySystem },
            { role: 'user', content: `Story section:\n${source}\n\nSummary:` },
          ],
        })
        const summary = response.replace(/\s+/g, ' ').trim()
        if (!summary) throw new Error('Ollama returned an empty section summary.')
        chapter.value.summaries.push({
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          source,
          summary,
        })
        added++
      }
      status.value = added ? `Summarized ${added} older section${added === 1 ? '' : 's'}` : 'No older sections need summarizing yet'
    } catch (cause) {
      error.value = cause instanceof Error ? `Summary failed: ${cause.message}` : 'Summary failed.'
      status.value = ''
    } finally {
      summarizing.value = false
    }
  }

  return { summarizing, summarizeOlderSections }
}
