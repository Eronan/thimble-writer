import { ref, type Ref } from 'vue'
import { ollamaClient, ollamaRequestOptions } from '~/clients/ollamaClient'
import type { Draft, StoryChapter } from '~/types/storyWriter'
import { planStorySectionRanges, type StorySectionSummary } from '~/utils/storySections'
import { summaryRequestBudget, SUMMARY_REPLY_TOKENS } from '~/utils/contextBudget'
import { makeSummaryMessages, selectSummaryContext } from '~/utils/storySummary'

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

  // `replace` rebuilds every section from scratch. New summaries are collected separately and
  // only swapped in once all of them succeed, so a failed run (Ollama stopping, an oversized
  // paragraph) leaves the existing sections untouched. Later sections still get the new earlier
  // summaries as background, because the working list is what the context is drawn from.
  async function summarizeOlderSections(story = chapter.value.story, flush = true, replace = false) {
    if (summarizing.value || generating.value) return
    if (!draft.model) {
      error.value = 'Choose an Ollama model before summarizing story sections.'
      return
    }
    summarizing.value = true
    error.value = ''
    try {
      const budget = summaryRequestBudget(draft.numCtx)
      const working: StorySectionSummary[] = replace ? [] : chapter.value.summaries
      const sections = planStorySectionRanges(
        story,
        working,
        Math.max(1, Math.floor(draft.writerParagraphs) || 3),
        Math.max(1, Math.floor(draft.sectionParagraphs) || 4),
        flush,
        budget.sourceChars,
      )
      // Automatic summaries wait for complete sections; manual summarizing flushes eligible prose.
      if (!sections.length) {
        if (replace) {
          chapter.value.summaries = []
          status.value = 'Cleared sections; no older paragraphs to summarize yet'
        } else if (flush) {
          status.value = 'No older sections need summarizing yet'
        }
        return
      }
      for (const section of sections) {
        if (section.text.length > budget.sourceChars) {
          throw new Error('A paragraph is longer than the summarizer context budget. Increase the context size or split that paragraph.')
        }
      }

      const produced: StorySectionSummary[] = []
      for (const [index, section] of sections.entries()) {
        status.value = `Summarizing section ${index + 1} of ${sections.length}…`
        const background = selectSummaryContext(story, working, section.start, budget.contextChars)
        const response = await ollamaClient.chat({
          label: 'Section summary',
          model: draft.model,
          options: ollamaRequestOptions(draft, {
            temperature: 0.3,
            maxTokens: SUMMARY_REPLY_TOKENS,
            repeatPenalty: null,
          }),
          messages: makeSummaryMessages(section.text, background),
        })
        const summary = response.replace(/\s+/g, ' ').trim()
        if (!summary) throw new Error('Ollama returned an empty section summary.')
        const entry = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          source: section.text,
          summary,
        }
        produced.push(entry)
        // In replace mode `working` is the fresh list; otherwise it is the chapter's own list.
        if (replace) working.push(entry)
        else chapter.value.summaries.push(entry)
      }
      if (replace) chapter.value.summaries = produced
      const count = produced.length
      status.value = replace
        ? `Re-summarized ${count} section${count === 1 ? '' : 's'}`
        : `Summarized ${count} older section${count === 1 ? '' : 's'}`
    } catch (cause) {
      error.value = cause instanceof Error ? `Summary failed: ${cause.message}` : 'Summary failed.'
      status.value = replace ? 'Existing sections were kept' : ''
    } finally {
      summarizing.value = false
    }
  }

  function resummarizeAllSections() {
    return summarizeOlderSections(chapter.value.story, true, true)
  }

  return { summarizing, summarizeOlderSections, resummarizeAllSections }
}
