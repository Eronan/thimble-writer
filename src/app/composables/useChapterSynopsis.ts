import { computed, ref, type Ref } from 'vue'
import { ollamaClient, ollamaRequestOptions } from '~/clients/ollamaClient'
import type { Draft, StoryChapter } from '~/types/storyWriter'
import {
  allChapterStructureBudget,
  chapterSynopsisBudget,
  SUMMARY_REPLY_TOKENS,
  summarySourceBudget,
} from '~/utils/contextBudget'
import {
  buildAllChapterStructureContext,
  buildChapterSynopsisContext,
  chapterStructureResponseFormat,
  parseChapterStructureResponse,
} from '~/utils/chapterSynopsis'
import { formatLoreForPrompt } from '~/utils/loreWorkspace'

type ChapterSynopsisOptions = {
  draft: Draft
  chapter: Ref<StoryChapter>
  generating: Ref<boolean>
  summarizing: Ref<boolean>
  revisingFeedback: Ref<boolean>
  proofreading: Ref<boolean>
  error: Ref<string>
  status: Ref<string>
}

const chapterSynopsisSystem = 'Write a concise chapter synopsis in past tense, naming the important characters, events, and changes. Return only the synopsis.'
const chapterStructureSystem = 'Create a detailed, actionable story structure for one chapter, written as a chapter synopsis in past tense. Include the opening situation, major events in order, the central conflict, a meaningful turning point or climax, and the outcome or transition. Name important characters and concrete changes, with enough detail to guide drafting. Return only the structure.'
const allChapterStructureSystem = 'Return a JSON object with a chapters array. Each item must contain a title and a detailed synopsis. Preserve existing chapter order and return an item for each existing chapter; append additional chapters only when required by the story. Keep each synopsis actionable, in past tense, and describe major events, conflict, turning point, and outcome. Follow the user’s structure direction.'
const storyChunkSystem = 'Summarize this story passage in one or two concise sentences. Preserve the important characters, events, and changes. Return only the summary.'

function splitText(text: string, maxChars: number): string[] {
  const chunks: string[] = []
  for (let offset = 0; offset < text.length; offset += maxChars) {
    chunks.push(text.slice(offset, offset + maxChars))
  }
  return chunks
}

export function useChapterSynopsis(options: ChapterSynopsisOptions) {
  const fixingSynopsis = ref(false)
  const generatingSynopsisId = ref<string | null>(null)
  const generatingAllStructure = ref(false)
  const busy = computed(() =>
    fixingSynopsis.value || generatingSynopsisId.value !== null || generatingAllStructure.value,
  )
  const {
    draft,
    chapter,
    generating,
    summarizing,
    revisingFeedback,
    proofreading,
    error,
    status,
  } = options

  function canStart() {
    if (busy.value || generating.value || summarizing.value || revisingFeedback.value || proofreading.value) return false
    if (!draft.model) {
      error.value = 'Choose an Ollama model before generating a chapter synopsis.'
      return false
    }
    return true
  }

  async function fixChapterSynopsis() {
    if (!canStart()) return
    if (!chapter.value.story.trim()) {
      error.value = 'Write some story text before fixing the chapter synopsis.'
      return
    }
    fixingSynopsis.value = true
    error.value = ''
    status.value = 'Summarizing this chapter…'
    try {
      const { inputChars, outputTokens } = chapterSynopsisBudget(draft.numCtx)
      const sourceBudget = Math.max(1, Math.min(
        summarySourceBudget(draft.numCtx),
        inputChars - chapterSynopsisSystem.length - 120,
      ))
      const finalInputBudget = inputChars - chapterSynopsisSystem.length - 120
      const chunks = splitText(chapter.value.story, sourceBudget)
      if (chunks.length === 1) {
        const synopsis = await ollamaClient.chat({
          label: 'Chapter synopsis (from text)',
          model: draft.model,
          options: ollamaRequestOptions(draft, {
            temperature: 0.2,
            maxTokens: outputTokens,
            repeatPenalty: null,
          }),
          messages: [
            { role: 'system', content: chapterSynopsisSystem },
            { role: 'user', content: `Chapter story:\n${chunks[0]}` },
          ],
        })
        if (!synopsis.trim()) throw new Error('Ollama returned an empty chapter synopsis.')
        chapter.value.synopsis = synopsis.trim()
      } else {
        let summaries: string[] = []
        for (const [index, chunk] of chunks.entries()) {
          status.value = `Summarizing story passages (${index + 1}/${chunks.length})…`
          const response = await ollamaClient.chat({
            label: 'Chapter summary (chunk)',
            model: draft.model,
            options: ollamaRequestOptions(draft, {
              temperature: 0.2,
              maxTokens: SUMMARY_REPLY_TOKENS,
              repeatPenalty: null,
            }),
            messages: [
              { role: 'system', content: storyChunkSystem },
              { role: 'user', content: `Story passage:\n${chunk}` },
            ],
          })
          if (!response.trim()) throw new Error('Ollama returned an empty story summary.')
          summaries.push(response.trim())
        }

        const reductionBudget = inputChars - storyChunkSystem.length - 120
        while (summaries.join('\n\n').length > finalInputBudget) {
          const groups: string[][] = []
          let group: string[] = []
          let groupChars = 0
          for (const summary of summaries) {
            const addition = summary.length + (group.length ? 2 : 0)
            if (group.length && groupChars + addition > reductionBudget) {
              groups.push(group)
              group = []
              groupChars = 0
            }
            group.push(summary)
            groupChars += summary.length + (group.length > 1 ? 2 : 0)
          }
          if (group.length) groups.push(group)
          if (groups.length >= summaries.length) {
            throw new Error('Could not reduce the chapter story summaries to fit the model context.')
          }
          const next: string[] = []
          for (const [index, batch] of groups.entries()) {
            status.value = `Summarizing story passages (${index + 1}/${groups.length})…`
            const response = await ollamaClient.chat({
              label: 'Chapter summary (merge)',
              model: draft.model,
              options: ollamaRequestOptions(draft, {
                temperature: 0.2,
                maxTokens: SUMMARY_REPLY_TOKENS,
                repeatPenalty: null,
              }),
              messages: [
                { role: 'system', content: storyChunkSystem },
                { role: 'user', content: `Story passages:\n${batch.join('\n\n')}` },
              ],
            })
            if (!response.trim()) throw new Error('Ollama returned an empty story summary.')
            next.push(response.trim())
          }
          summaries = next
        }
        const synopsis = await ollamaClient.chat({
          label: 'Chapter synopsis (from summaries)',
          model: draft.model,
          options: ollamaRequestOptions(draft, {
            temperature: 0.2,
            maxTokens: outputTokens,
            repeatPenalty: null,
          }),
          messages: [
            { role: 'system', content: chapterSynopsisSystem },
            { role: 'user', content: `Summaries of this chapter's story:\n${summaries.join('\n\n')}` },
          ],
        })
        if (!synopsis.trim()) throw new Error('Ollama returned an empty chapter synopsis.')
        chapter.value.synopsis = synopsis.trim()
      }
      status.value = 'Chapter synopsis updated from this chapter’s story'
    } catch (cause) {
      error.value = cause instanceof Error ? `Could not fix chapter synopsis: ${cause.message}` : 'Could not fix chapter synopsis.'
      status.value = ''
    } finally {
      fixingSynopsis.value = false
    }
  }

  async function generateChapterSynopsis(chapterId: string) {
    if (!canStart()) return
    const target = draft.chapters.find(item => item.id === chapterId)
    if (!target) {
      error.value = 'Could not find the chapter to generate a synopsis for.'
      return
    }
    generatingSynopsisId.value = chapterId
    error.value = ''
    status.value = `Generating story structure for ${target.title.trim() || 'chapter'}…`
    try {
      const budget = chapterSynopsisBudget(draft.numCtx)
      const context = buildChapterSynopsisContext(
        target,
        draft.chapters,
        formatLoreForPrompt(draft),
        budget.inputChars - chapterStructureSystem.length,
        draft.structurePrompt,
      )
      const response = await ollamaClient.chat({
        label: 'Chapter synopsis (planning)',
        model: draft.model,
        options: ollamaRequestOptions(draft, {
          temperature: 0.4,
          maxTokens: budget.outputTokens,
          repeatPenalty: null,
        }),
        messages: [
          { role: 'system', content: chapterStructureSystem },
          { role: 'user', content: context.context },
        ],
      })
      if (!response.trim()) throw new Error('Ollama returned an empty chapter synopsis.')
      target.synopsis = response.trim()
      status.value = context.clipped
        ? 'Story structure generated (some context was clipped to fit the model budget)'
        : 'Story structure generated'
    } catch (cause) {
      error.value = cause instanceof Error ? `Could not generate story structure: ${cause.message}` : 'Could not generate story structure.'
      status.value = ''
    } finally {
      generatingSynopsisId.value = null
    }
  }

  async function generateAllChapterStructure() {
    if (!canStart()) return
    generatingAllStructure.value = true
    error.value = ''
    status.value = 'Generating structure for all chapters…'
    try {
      const existingChapterCount = draft.chapters.length
      const { outputTokens, inputChars } = allChapterStructureBudget(draft.numCtx, existingChapterCount)
      if (inputChars < 500) {
        throw new Error('The context window is too small for a full structure response. Increase the context size or reduce the chapter count.')
      }
      const context = buildAllChapterStructureContext(
        draft.chapters,
        formatLoreForPrompt(draft),
        draft.structurePrompt,
        inputChars - allChapterStructureSystem.length,
      )
      const structures = await ollamaClient.chat({
        label: 'Chapter structure (all chapters)',
        model: draft.model,
        options: ollamaRequestOptions(draft, {
          temperature: 0.4,
          maxTokens: outputTokens,
          repeatPenalty: null,
        }),
        format: chapterStructureResponseFormat,
        parse: text => parseChapterStructureResponse(text, draft.chapters.length),
        messages: [
          { role: 'system', content: allChapterStructureSystem },
          { role: 'user', content: context.context },
        ],
      })
      for (let index = 0; index < draft.chapters.length; index += 1) {
        const chapter = draft.chapters[index]!
        const structure = structures[index]!
        chapter.title = structure.title
        chapter.synopsis = structure.synopsis
      }
      for (const structure of structures.slice(draft.chapters.length)) {
        draft.chapters.push({
          id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          title: structure.title,
          synopsis: structure.synopsis,
          story: '',
          summaries: [],
          feedback: [],
          feedbackRevisions: [],
        })
      }
      const addedCount = structures.length - existingChapterCount
      status.value = context.clipped
        ? `Generated structure for ${structures.length} chapters${addedCount ? ` (added ${addedCount})` : ''}; some prompt context was clipped`
        : `Generated structure for ${structures.length} chapters${addedCount ? ` (added ${addedCount})` : ''}`
    } catch (cause) {
      error.value = cause instanceof Error
        ? `Could not generate all chapter structures: ${cause.message}`
        : 'Could not generate all chapter structures.'
      status.value = ''
    } finally {
      generatingAllStructure.value = false
    }
  }

  return {
    busy,
    fixingSynopsis,
    generatingSynopsisId,
    generatingAllStructure,
    fixChapterSynopsis,
    generateChapterSynopsis,
    generateAllChapterStructure,
  }
}
