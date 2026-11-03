import { migrateDraftData } from './draftSchema.ts'

// A draft file is the same JSON the app keeps in browser storage. Reading one always goes
// through the migrations, so an old export can still be opened after the schema changes.
export function serializeDraftFile(draft: unknown): string {
  return `${JSON.stringify(draft, null, 2)}\n`
}

export function parseDraftFile(text: string): ReturnType<typeof migrateDraftData> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  return migrateDraftData(parsed)
}

export function draftFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`
  return `thimble-story-${date}-${time}.json`
}
