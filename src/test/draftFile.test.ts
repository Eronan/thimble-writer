import assert from 'node:assert/strict'
import test from 'node:test'
import { DRAFT_SCHEMA_VERSION } from '../app/utils/draftSchema.ts'
import { draftFileName, parseDraftFile, serializeDraftFile } from '../app/utils/draftFile.ts'

test('a serialized draft round-trips through parseDraftFile', () => {
  const draft = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    synopsisSections: [{ id: 'premise', title: 'Premise', text: 'Keep this' }],
    guidanceSections: [],
    disabledContextIds: [],
    characters: [],
    chapters: [{
      id: 'chapter-1',
      title: 'Chapter 1',
      synopsis: '',
      story: 'Once.',
      summaries: [],
      feedback: [],
      feedbackRevisions: [],
    }],
    activeChapterId: 'chapter-1',
    structurePrompt: '',
  }
  assert.deepEqual(parseDraftFile(serializeDraftFile(draft)), draft)
})

test('an old exported file is migrated when it is loaded', () => {
  const migrated = parseDraftFile(JSON.stringify({ schemaVersion: 2, synopsis: 'Old', story: 'Opening.' }))
  assert.equal(migrated.schemaVersion, DRAFT_SCHEMA_VERSION)
  assert.equal((migrated.chapters as { story: string }[])[0]!.story, 'Opening.')
})

test('invalid files fail with a readable error', () => {
  assert.throws(() => parseDraftFile('not json'), /not valid JSON/)
  assert.throws(() => parseDraftFile('[]'), /must be an object/)
  assert.throws(() => parseDraftFile(JSON.stringify({ schemaVersion: 999 })), /Unsupported/)
})

test('file names are timestamped', () => {
  assert.equal(draftFileName(new Date(2026, 10, 4, 9, 5)), 'thimble-story-2026-11-04-0905.json')
})
