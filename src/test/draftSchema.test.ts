import assert from 'node:assert/strict'
import test from 'node:test'
import { DRAFT_SCHEMA_VERSION, migrateDraftData } from '../app/utils/draftSchema.ts'

test('unversioned freeform lore migrates to current schema and keeps kind in guidance', () => {
  const migrated = migrateDraftData({
    lore: 'A cartographer hears places remember.',
    kind: 'Cozy fantasy',
    guidance: 'Keep the tone gentle.',
    characters: 'Mara maps the city.',
    setting: 'The city moves at night.',
    prompt: 'Find the hidden door.',
  })
  assert.equal(migrated.schemaVersion, DRAFT_SCHEMA_VERSION)
  assert.equal(migrated.synopsis, 'A cartographer hears places remember.')
  assert.equal(migrated.guidance, 'Keep the tone gentle.\n\nCozy fantasy')
  assert.deepEqual(migrated.characters, [{
    id: 'legacy-character',
    name: '',
    details: 'Mara maps the city.',
    appearance: '',
  }])
  assert.deepEqual(migrated.setting, [{
    id: 'legacy-setting',
    name: '',
    details: 'The city moves at night.',
    appearance: '',
  }])
  assert.equal(migrated.prompt, 'Find the hidden door.')
  assert.equal('lore' in migrated, false)
  assert.equal('kind' in migrated, false)
})

test('versionless list-based drafts retain character appearance during migration', () => {
  const migrated = migrateDraftData({
    characters: [{ id: 'mara', name: 'Mara', details: 'Cartographer.', appearance: 'Silver hair.' }],
    setting: [{ id: 'city', name: 'City', details: 'Moves at night.' }],
  })
  assert.deepEqual(migrated.characters, [{
    id: 'mara',
    name: 'Mara',
    details: 'Cartographer.',
    appearance: 'Silver hair.',
  }])
  assert.equal(migrated.schemaVersion, DRAFT_SCHEMA_VERSION)
})

test('version one drafts gain the optional character appearance field', () => {
  const migrated = migrateDraftData({
    schemaVersion: 1,
    characters: [{ id: 'mara', name: 'Mara', details: 'Cartographer.' }],
    setting: [],
  })
  assert.deepEqual(migrated.characters, [{
    id: 'mara',
    name: 'Mara',
    details: 'Cartographer.',
    appearance: '',
  }])
  assert.equal(migrated.schemaVersion, DRAFT_SCHEMA_VERSION)
})

test('current drafts stay stable and unsupported future schema versions fail explicitly', () => {
  const current = { schemaVersion: DRAFT_SCHEMA_VERSION, synopsis: 'Keep this', characters: [] }
  assert.deepEqual(migrateDraftData(current), current)
  assert.throws(
    () => migrateDraftData({ schemaVersion: DRAFT_SCHEMA_VERSION + 1 }),
    /Unsupported draft schema version/,
  )
})
