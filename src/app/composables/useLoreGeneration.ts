import { computed, ref, type Ref } from 'vue'
import { ollamaClient, ollamaRequestOptions } from '~/clients/ollamaClient'
import type { Draft } from '~/types/storyWriter'
import {
  buildLoreGenerationContext,
  characterResponseFormat,
  parseGeneratedLoreDetails,
  settingResponseFormat,
  type LoreGenerationKind,
} from '~/utils/loreGeneration'
import { CHAPTER_SYNOPSIS_CONTEXT_RESERVE_TOKENS, charsForContextBudget } from '~/utils/contextBudget'

type LoreGenerationOptions = {
  draft: Draft
  generating: Ref<boolean>
  summarizing: Ref<boolean>
  revisingFeedback: Ref<boolean>
  proofreading: Ref<boolean>
  error: Ref<string>
  status: Ref<string>
}

export function useLoreGeneration(options: LoreGenerationOptions) {
  const generatingLoreId = ref<string | null>(null)
  const busy = computed(() => generatingLoreId.value !== null)

  async function generateLoreEntry(kind: LoreGenerationKind, id: string) {
    const {
      draft,
      generating,
      summarizing,
      revisingFeedback,
      proofreading,
      error,
      status,
    } = options
    if (
      busy.value
      || generating.value
      || summarizing.value
      || revisingFeedback.value
      || proofreading.value
    ) return
    if (!draft.model) {
      error.value = 'Choose an Ollama model before generating Lore.'
      status.value = ''
      return
    }
    const entries = kind === 'character' ? draft.characters : draft.setting
    const target = entries.find(entry => entry.id === id)
    if (!target) {
      error.value = `Could not find the ${kind} to generate.`
      status.value = ''
      return
    }
    generatingLoreId.value = id
    error.value = ''
    status.value = `Generating ${kind} details for ${target.name.trim() || 'new entry'}…`
    try {
      const outputTokens = Math.min(500, Math.max(1, draft.numCtx - 200))
      const inputChars = charsForContextBudget(
        draft.numCtx,
        outputTokens,
        CHAPTER_SYNOPSIS_CONTEXT_RESERVE_TOKENS,
      )
      const system = kind === 'character'
        ? 'Create or refine one useful character for a story bible. Preserve the existing name and character type unless the user explicitly requests a change. Return a JSON object with name, characterType (for example protagonist, antagonist, or side character), concise core details covering relevant personality, motivation, history, and relationships, and appearance as a separate visual description (empty string when unspecified). Respect established story facts and the user request.'
        : 'Create or refine one useful setting entry for a story bible. Preserve the existing name unless the user explicitly requests a change. Return a JSON object with a concise name and details covering relevant atmosphere, history, rules, and story significance. Respect established story facts and the user request.'
      const context = buildLoreGenerationContext(
        draft,
        kind,
        target,
        target.generationPrompt ?? '',
        inputChars - system.length,
      )
      const generated = await ollamaClient.chat({
        label: 'Lore generation',
        model: draft.model,
        options: ollamaRequestOptions(draft, {
          temperature: 0.4,
          maxTokens: outputTokens,
          repeatPenalty: null,
        }),
        format: kind === 'character' ? characterResponseFormat : settingResponseFormat,
        parse: text => parseGeneratedLoreDetails(text, kind),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: context.context },
        ],
      })
      target.name = generated.name
      target.details = generated.details
      if (kind === 'character') {
        target.appearance = generated.appearance ?? ''
        target.characterType = generated.characterType ?? ''
      }
      status.value = context.clipped
        ? `${kind === 'character' ? 'Character' : 'Setting'} generated (some story context was clipped)`
        : `${kind === 'character' ? 'Character' : 'Setting'} generated`
    } catch (cause) {
      error.value = cause instanceof Error
        ? `Could not generate ${kind} details: ${cause.message}`
        : `Could not generate ${kind} details.`
      status.value = ''
    } finally {
      generatingLoreId.value = null
    }
  }

  return { busy, generatingLoreId, generateLoreEntry }
}
