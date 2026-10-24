import { migrateLoreFields } from './loreWorkspace.ts'
import type { LoreNote } from './loreWorkspace.ts'
import type { StoryChapter } from '~/types/storyWriter'

export const DRAFT_SCHEMA_VERSION = 4

type DraftData = Record<string, unknown> & {
  schemaVersion?: unknown
}

function versionZeroToOne(data: DraftData): DraftData {
  const lore = migrateLoreFields(data)
  const next: DraftData = {
    ...data,
    ...lore,
    schemaVersion: 1,
  }
  delete next.lore
  delete next.kind
  return next
}

function migrateEntries(value: unknown): LoreNote[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (typeof item !== 'object' || item === null) return []
    const entry = item as Record<string, unknown>
    const name = typeof entry.name === 'string' ? entry.name : ''
    const details = typeof entry.details === 'string' ? entry.details : ''
    const appearance = typeof entry.appearance === 'string' ? entry.appearance : ''
    if (!name.trim() && !details.trim() && !appearance.trim()) return []
    return [{
      id: typeof entry.id === 'string' && entry.id ? entry.id : `lore-entry-${index}`,
      name,
      details,
      appearance,
    }]
  })
}

function versionOneToTwo(data: DraftData): DraftData {
  return {
    ...data,
    characters: migrateEntries(data.characters),
    setting: migrateEntries(data.setting),
    schemaVersion: 2,
  }
}

function createChapter(
  id: string,
  title: string,
  value: Record<string, unknown> = {},
): StoryChapter {
  return {
    id,
    title,
    synopsis: typeof value.synopsis === 'string' ? value.synopsis : '',
    story: typeof value.story === 'string' ? value.story : '',
    summaries: Array.isArray(value.summaries)
      ? value.summaries.filter((item): item is StoryChapter['summaries'][number] =>
          typeof item?.id === 'string'
          && typeof item?.source === 'string'
          && typeof item?.summary === 'string',
        )
      : [],
    feedback: Array.isArray(value.feedback)
      ? value.feedback.filter((item): item is StoryChapter['feedback'][number] =>
          typeof item?.id === 'string'
          && typeof item?.source === 'string'
          && typeof item?.instruction === 'string'
          && Number.isInteger(item?.start),
        )
      : [],
    feedbackRevisions: Array.isArray(value.feedbackRevisions)
      ? value.feedbackRevisions.filter((item): item is StoryChapter['feedbackRevisions'][number] =>
          typeof item?.id === 'string'
          && typeof item?.instruction === 'string'
          && typeof item?.before === 'string'
          && typeof item?.after === 'string'
          && Number.isFinite(item?.appliedAt),
        )
      : [],
  }
}

function migrateChapter(value: unknown, index: number): StoryChapter | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  const id = typeof item.id === 'string' && item.id ? item.id : `chapter-${index + 1}`
  const title = typeof item.title === 'string' && item.title.trim()
    ? item.title
    : `Chapter ${index + 1}`
  return createChapter(id, title, item)
}

function versionTwoToThree(data: DraftData): DraftData {
  const chapters = Array.isArray(data.chapters)
    ? data.chapters.map(migrateChapter).filter((chapter): chapter is StoryChapter => chapter !== null)
    : []
  const migratedChapters = chapters.length
    ? chapters
    : [createChapter('chapter-1', 'Chapter 1', { ...data, synopsis: '' })]
  const activeChapterId = typeof data.activeChapterId === 'string'
    && migratedChapters.some(chapter => chapter.id === data.activeChapterId)
    ? data.activeChapterId
    : migratedChapters[0]?.id ?? 'chapter-1'
  const next: DraftData = {
    ...data,
    chapters: migratedChapters,
    activeChapterId,
    schemaVersion: 3,
  }
  delete next.story
  delete next.summaries
  delete next.feedback
  delete next.feedbackRevisions
  return next
}

function versionThreeToFour(data: DraftData): DraftData {
  return {
    ...data,
    structurePrompt: typeof data.structurePrompt === 'string' ? data.structurePrompt : '',
    schemaVersion: 4,
  }
}

const migrations: Record<number, (data: DraftData) => DraftData> = {
  0: versionZeroToOne,
  1: versionOneToTwo,
  2: versionTwoToThree,
  3: versionThreeToFour,
}

function inferVersion(data: DraftData): number {
  if (data.schemaVersion !== undefined) {
    if (!Number.isInteger(data.schemaVersion)) throw new TypeError('Saved draft schema version must be an integer.')
    return data.schemaVersion as number
  }
  if (typeof data.characters === 'string' || typeof data.setting === 'string') return 0
  // The list-based Lore editor shipped before persistence had a version field.
  return Array.isArray(data.characters) || Array.isArray(data.setting) ? 1 : 0
}

export function migrateDraftData(value: unknown): DraftData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Saved draft must be an object.')
  }
  let data = value as DraftData
  let version = inferVersion(data)
  if (version > DRAFT_SCHEMA_VERSION || version < 0) {
    throw new Error(`Unsupported draft schema version: ${version}.`)
  }
  while (version < DRAFT_SCHEMA_VERSION) {
    const migrate = migrations[version]
    if (!migrate) throw new Error(`No draft migration exists for schema version ${version}.`)
    data = migrate(data)
    version = inferVersion(data)
  }
  const chapters = Array.isArray(data.chapters)
    ? data.chapters.map(migrateChapter).filter((chapter): chapter is StoryChapter => chapter !== null)
    : []
  const normalizedChapters = chapters.length
    ? chapters
    : [createChapter('chapter-1', 'Chapter 1')]
  const activeChapterId = typeof data.activeChapterId === 'string'
    && normalizedChapters.some(chapter => chapter.id === data.activeChapterId)
    ? data.activeChapterId
    : normalizedChapters[0]?.id ?? 'chapter-1'
  return {
    ...data,
    structurePrompt: typeof data.structurePrompt === 'string' ? data.structurePrompt : '',
    chapters: normalizedChapters,
    activeChapterId,
    schemaVersion: DRAFT_SCHEMA_VERSION,
  }
}
