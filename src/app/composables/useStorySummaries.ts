import { ref, type Ref } from 'vue'
import { ollamaClient, ollamaRequestOptions } from '~/clients/ollamaClient'
import type { Draft, StoryChapter } from '~/types/storyWriter'
import { planStorySectionRanges, type StorySectionSummary } from '~/utils/storySections'
import { summaryRequestBudget, SUMMARY_REPLY_TOKENS } from '~/utils/contextBudget'
import type { ContextItem } from '~/utils/loreWorkspace'
import { makeSummaryMessages, selectSummaryContext } from '~/utils/storySummary'
import {
  buildSummaryPickRequest,
  formatSummaryReference,
  parseSummaryPickResponse,
  summaryPickCandidates,
  summaryPickResponseFormat,
} from '~/utils/summaryContext'

type StorySummaryOptions = {
  draft: Draft
  chapter: Readonly<Ref<StoryChapter>>
  generating: Ref<boolean>
  error: Ref<string>
  status: Ref<string>
  // Every lore entry. The model picks the ones each section needs; Context ticks are not used.
  items: Readonly<Ref<ContextItem[]>>
}

export function useStorySummaries(options: StorySummaryOptions) {
  const summarizing = ref(false)
  const { draft, chapter, generating, error, status, items } = options

  // Asks the model which characters, places and synopsis entries this section involves, so the
  // summary can name them correctly. It only informs one summary request and never changes ticks.
  async function pickReference(sectionText: string, background: string[]): Promise<ContextItem[]> {
    const candidates = summaryPickCandidates(items.value)
    if (!candidates.length) return []
    const request = buildSummaryPickRequest({
      items: candidates,
      sectionText,
      background,
      chapterSynopsis: chapter.value.synopsis,
      numCtx: draft.numCtx,
    })
    const selected = await ollamaClient.chat({
      label: 'Summary context pick',
      model: draft.model,
      options: ollamaRequestOptions(draft, {
        temperature: Math.min(draft.temperature, 0.2),
        maxTokens: request.outputTokens,
        repeatPenalty: null,
      }),
      format: summaryPickResponseFormat,
      parse: text => parseSummaryPickResponse(text, candidates.length),
      messages: request.messages,
    })
    return [...selected].sort((left, right) => left - right).map(number => candidates[number - 1]!)
  }

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
      let pickFailures = 0
      const canPick = summaryPickCandidates(items.value).length > 0
      for (const [index, section] of sections.entries()) {
        const where = `Summarizing section ${index + 1} of ${sections.length}`
        status.value = canPick ? `${where}: choosing context…` : `${where}…`
        const background = selectSummaryContext(story, working, section.start, budget.contextChars)
        // A failed pick should not lose the summary: it falls back to summarizing without lore.
        let picked: ContextItem[] = []
        if (canPick) {
          try {
            picked = await pickReference(section.text, background)
          } catch {
            pickFailures++
          }
          status.value = `${where}: writing summary…`
        }
        const reference = formatSummaryReference({
          entries: picked,
          chapterSynopsis: chapter.value.synopsis,
          maxChars: budget.referenceChars,
        })
        const response = await ollamaClient.chat({
          label: 'Section summary',
          model: draft.model,
          options: ollamaRequestOptions(draft, {
            temperature: 0.3,
            maxTokens: SUMMARY_REPLY_TOKENS,
            repeatPenalty: null,
          }),
          messages: makeSummaryMessages(section.text, background, reference),
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
      const pickNote = pickFailures
        ? ` (context pick failed for ${pickFailures} section${pickFailures === 1 ? '' : 's'}; those summaries used no lore)`
        : ''
      status.value = (replace
        ? `Re-summarized ${count} section${count === 1 ? '' : 's'}`
        : `Summarized ${count} older section${count === 1 ? '' : 's'}`) + pickNote
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
