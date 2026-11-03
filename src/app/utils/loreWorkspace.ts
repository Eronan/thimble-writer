export type LoreNote = {
  id: string
  name: string
  details: string
  appearance?: string
  generationPrompt?: string
  characterType?: string
}

// A titled block of story setup (a synopsis part, a guidance rule). Each section can be
// ticked or unticked on its own when choosing what the next scene is written from.
export type ContextSection = {
  id: string
  title: string
  text: string
}

export type LoreFields = {
  synopsisSections: ContextSection[]
  guidanceSections: ContextSection[]
  characters: LoreNote[]
  setting: LoreNote[]
}

// Shape of drafts saved before synopsis and guidance were split into sections.
export type LegacyLoreFields = {
  synopsis: string
  guidance: string
  characters: LoreNote[]
  setting: LoreNote[]
}

export type ContextGroup = 'synopsis' | 'guidance' | 'characters' | 'setting'

export type ContextItem = {
  id: string
  group: ContextGroup
  label: string
  text: string
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

export function migrateLoreFields(data: LoreFieldData): LegacyLoreFields {
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

export function createContextSection(id: string, title = '', text = ''): ContextSection {
  return { id, title, text }
}

export function normalizeSections(value: unknown, legacyId: string): ContextSection[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (typeof item !== 'object' || item === null) return []
    const section = item as Record<string, unknown>
    return [{
      id: typeof section.id === 'string' && section.id ? section.id : `${legacyId}-${index + 1}`,
      title: typeof section.title === 'string' ? section.title : '',
      text: typeof section.text === 'string' ? section.text : '',
    }]
  })
}

function sectionText(section: ContextSection): string {
  return [section.title.trim(), section.text.trim()].filter(Boolean).join('\n')
}

function characterBlocks(entry: LoreNote): string[] {
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
}

function settingBlock(entry: LoreNote): string {
  return [entry.name.trim(), entry.details.trim()].filter(Boolean).join('\n')
}

// Everything the user can tick for the next scene, in prompt order. Empty entries are left out
// because there is nothing to send, so there is nothing to choose.
export function buildContextItems(fields: LoreFields): ContextItem[] {
  const sections = (group: 'synopsis' | 'guidance', list: ContextSection[], fallback: string): ContextItem[] =>
    list.flatMap((section, index) => {
      const text = sectionText(section)
      return text
        ? [{ id: section.id, group, label: section.title.trim() || `${fallback} ${index + 1}`, text }]
        : []
    })
  return [
    ...sections('synopsis', fields.synopsisSections, 'Synopsis'),
    ...sections('guidance', fields.guidanceSections, 'Guidance'),
    ...fields.characters.flatMap((entry, index) => {
      const text = characterBlocks(entry).join('\n\n')
      return text
        ? [{ id: entry.id, group: 'characters' as const, label: entry.name.trim() || `Character ${index + 1}`, text }]
        : []
    }),
    ...fields.setting.flatMap((entry, index) => {
      const text = settingBlock(entry)
      return text
        ? [{ id: entry.id, group: 'setting' as const, label: entry.name.trim() || `Setting ${index + 1}`, text }]
        : []
    }),
  ]
}

// Entries whose ids are in `excludedIds` are dropped before the lore selector ever sees them.
export function formatLoreForPrompt(fields: LoreFields, excludedIds: ReadonlySet<string> = new Set()): string {
  const kept = (id: string) => !excludedIds.has(id)
  return [
    ...fields.synopsisSections.filter(section => kept(section.id)).map(sectionText),
    ...fields.guidanceSections.filter(section => kept(section.id)).map(sectionText),
    ...fields.characters.filter(entry => kept(entry.id)).flatMap(characterBlocks),
    ...fields.setting.filter(entry => kept(entry.id)).map(settingBlock),
  ].map(value => value.trim()).filter(Boolean).join('\n\n')
}

// Plain prose for prompts that want the whole synopsis or guidance regardless of ticks.
export function formatSections(sections: ContextSection[]): string {
  return sections.map(sectionText).filter(Boolean).join('\n\n')
}
