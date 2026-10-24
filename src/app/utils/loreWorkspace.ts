export type LoreNote = {
  id: string
  name: string
  details: string
  appearance?: string
  generationPrompt?: string
  characterType?: string
}

export type LoreFields = {
  synopsis: string
  guidance: string
  characters: LoreNote[]
  setting: LoreNote[]
}

export type LoreFieldData = {
  synopsis?: unknown
  guidance?: unknown
  prompt?: unknown
  kind?: unknown
  characters?: unknown
  setting?: unknown
  lore?: unknown
}

function migrateEntries(value: unknown, legacyId: string, includeCharacterType = false): LoreNote[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      if (typeof entry !== 'object' || entry === null) return []
      const candidate = entry as Record<string, unknown>
      const name = typeof candidate.name === 'string' ? candidate.name : ''
      const details = typeof candidate.details === 'string' ? candidate.details : ''
      const appearance = typeof candidate.appearance === 'string' ? candidate.appearance : ''
      const generationPrompt = typeof candidate.generationPrompt === 'string' ? candidate.generationPrompt : ''
      const characterType = typeof candidate.characterType === 'string' ? candidate.characterType : ''
      if (!name.trim() && !details.trim() && !appearance.trim() && !generationPrompt.trim() && !characterType.trim()) return []
      return [{
        id: typeof candidate.id === 'string' && candidate.id
          ? candidate.id
          : `${legacyId}-${index}`,
        name,
        details,
        appearance,
        generationPrompt,
        ...(includeCharacterType ? { characterType } : {}),
      }]
    })
  }
  return typeof value === 'string' && value.trim()
    ? [{ id: legacyId, name: '', details: value, appearance: '', generationPrompt: '', ...(includeCharacterType ? { characterType: '' } : {}) }]
    : []
}

export function migrateLoreFields(data: LoreFieldData): LoreFields {
  const oldKind = typeof data.kind === 'string' ? data.kind.trim() : ''
  const guidance = typeof data.guidance === 'string' ? data.guidance : ''
  return {
    synopsis: typeof data.synopsis === 'string'
      ? data.synopsis
      : typeof data.lore === 'string' ? data.lore : '',
    guidance: [guidance.trim(), oldKind].filter(Boolean).join('\n\n'),
    characters: migrateEntries(data.characters, 'legacy-character', true),
    setting: migrateEntries(data.setting, 'legacy-setting'),
  }
}

export function formatLoreForPrompt(fields: LoreFields): string {
  const characters = fields.characters.flatMap(entry => {
    const name = entry.name.trim()
    const characterType = entry.characterType?.trim() ?? ''
    const details = entry.details.trim()
    const appearance = entry.appearance?.trim() ?? ''
    return [
      [[name, characterType ? `(${characterType})` : ''].filter(Boolean).join(' '), details]
        .filter(Boolean)
        .join('\n'),
      appearance ? [name ? `${name} (appearance)` : 'Character appearance', appearance].join('\n') : '',
    ].filter(Boolean)
  })
  return [
    fields.synopsis,
    fields.guidance,
    ...characters,
    ...fields.setting.map(entry => [entry.name, entry.details].filter(Boolean).join('\n')),
  ].map(value => value.trim()).filter(Boolean).join('\n\n')
}
