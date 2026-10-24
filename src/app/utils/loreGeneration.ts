import type { Draft } from '~/types/storyWriter'
import type { LoreNote } from '~/utils/loreWorkspace'

export type LoreGenerationKind = 'character' | 'setting'
export type GeneratedLoreDetails = Pick<LoreNote, 'name' | 'details'> & { appearance?: string }

export const characterResponseFormat = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    details: { type: 'string' },
    appearance: { type: 'string' },
  },
  required: ['name', 'details', 'appearance'],
  additionalProperties: false,
} satisfies Record<string, unknown>

export const settingResponseFormat = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    details: { type: 'string' },
  },
  required: ['name', 'details'],
  additionalProperties: false,
} satisfies Record<string, unknown>

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  if (maxChars <= 0) return ''
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`
}

export function buildLoreGenerationContext(
  draft: Pick<Draft, 'synopsis' | 'guidance' | 'characters' | 'setting'>,
  kind: LoreGenerationKind,
  target: LoreNote,
  prompt: string,
  maxChars: number,
): { context: string; clipped: boolean } {
  if (!prompt.trim()) throw new Error(`Enter a prompt for this ${kind} before generating details.`)
  const heading = kind === 'character' ? 'character' : 'setting'
  const existing = [
    target.name.trim() ? `Name: ${target.name.trim()}` : '',
    target.details.trim() ? `Existing details:\n${target.details.trim()}` : '',
    kind === 'character' && target.appearance?.trim()
      ? `Existing appearance:\n${target.appearance.trim()}`
      : '',
  ].filter(Boolean).join('\n')
  const request = `Create or refine one ${heading}. Follow the requested details, keep established facts consistent, and return concise, useful story-bible content.\n\nRequest:\n${prompt.trim()}`
  const entry = existing ? `Current ${heading}:\n${existing}` : ''
  const background = [
    draft.synopsis.trim() ? `Story premise:\n${draft.synopsis.trim()}` : '',
    draft.guidance.trim() ? `Writing guidance:\n${draft.guidance.trim()}` : '',
  ].filter(Boolean).join('\n\n')
  const fixedChars = request.length + (entry ? entry.length + 2 : 0) + 48
  if (fixedChars > maxChars) {
    throw new Error(`This prompt and ${heading} details exceed the available model context. Shorten them or increase the context size.`)
  }
  const backgroundLimit = Math.max(0, maxChars - fixedChars)
  const fittedBackground = clip(background, backgroundLimit)
  const context = [
    request,
    entry,
    fittedBackground ? `Story context:\n${fittedBackground}` : '',
  ].filter(Boolean).join('\n\n')
  return { context, clipped: fittedBackground.length < background.length }
}

export function parseGeneratedLoreDetails(
  response: string,
  kind: LoreGenerationKind,
): GeneratedLoreDetails {
  let value: unknown
  try {
    value = JSON.parse(response.replace(/^\uFEFF/, '').trim()) as unknown
  } catch {
    throw new Error('Ollama returned invalid structured lore data.')
  }
  if (
    typeof value !== 'object'
    || value === null
    || !('name' in value)
    || typeof value.name !== 'string'
    || !value.name.trim()
    || !('details' in value)
    || typeof value.details !== 'string'
    || !value.details.trim()
  ) {
    throw new Error('Ollama returned incomplete structured lore data.')
  }
  if (kind === 'character') {
    if (!('appearance' in value) || typeof value.appearance !== 'string') {
      throw new Error('Ollama returned incomplete character appearance data.')
    }
    return {
      name: value.name.trim(),
      details: value.details.trim(),
      appearance: value.appearance.trim(),
    }
  }
  return { name: value.name.trim(), details: value.details.trim() }
}
