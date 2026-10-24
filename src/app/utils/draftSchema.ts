import { migrateLoreFields } from './loreWorkspace.ts'
import type { LoreNote } from './loreWorkspace.ts'

export const DRAFT_SCHEMA_VERSION = 2

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

const migrations: Record<number, (data: DraftData) => DraftData> = {
  0: versionZeroToOne,
  1: versionOneToTwo,
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
  return { ...data, schemaVersion: DRAFT_SCHEMA_VERSION }
}
