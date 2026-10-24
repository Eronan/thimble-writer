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
    generationPrompt: '',
    characterType: '',
  }])
  assert.deepEqual(migrated.setting, [{
    id: 'legacy-setting',
    name: '',
    details: 'The city moves at night.',
    appearance: '',
    generationPrompt: '',
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
    generationPrompt: '',
    characterType: '',
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
    generationPrompt: '',
    characterType: '',
  }])
  assert.equal(migrated.schemaVersion, DRAFT_SCHEMA_VERSION)
})

test('version two story data migrates into chapter one with chapter-scoped context', () => {
  const migrated = migrateDraftData({
    schemaVersion: 2,
    synopsis: 'A global story premise.',
    story: 'Opening scene.',
    summaries: [{ id: 'summary-1', source: 'Opening scene.', summary: 'The story began.' }],
    feedback: [{ id: 'feedback-1', start: 0, source: 'Opening', before: '', after: ' scene.', instruction: 'Check this.' }],
    feedbackRevisions: [{ id: 'revision-1', instruction: 'Improve it.', before: 'Opening', after: 'A beginning', appliedAt: 10 }],
  })
  assert.equal(migrated.activeChapterId, 'chapter-1')
  assert.deepEqual(migrated.chapters, [{
    id: 'chapter-1',
    title: 'Chapter 1',
    synopsis: '',
    story: 'Opening scene.',
    summaries: [{ id: 'summary-1', source: 'Opening scene.', summary: 'The story began.' }],
    feedback: [{ id: 'feedback-1', start: 0, source: 'Opening', before: '', after: ' scene.', instruction: 'Check this.' }],
    feedbackRevisions: [{ id: 'revision-1', instruction: 'Improve it.', before: 'Opening', after: 'A beginning', appliedAt: 10 }],
  }])
  assert.equal(migrated.synopsis, 'A global story premise.')
  assert.equal('story' in migrated, false)
  assert.equal(migrated.structurePrompt, '')
})

test('version three drafts gain the persisted structure generator prompt', () => {
  const migrated = migrateDraftData({
    schemaVersion: 3,
    chapters: [{
      id: 'chapter-1',
      title: 'Chapter 1',
      synopsis: 'Opening.',
      story: '',
      summaries: [],
      feedback: [],
      feedbackRevisions: [],
    }],
    activeChapterId: 'chapter-1',
  })
  assert.equal(migrated.schemaVersion, DRAFT_SCHEMA_VERSION)
  assert.equal(migrated.structurePrompt, '')
})

test('version four drafts migrate per-entry Lore prompts', () => {
  const migrated = migrateDraftData({
    schemaVersion: 4,
    synopsis: 'A story premise.',
    characters: [{ id: 'mara', name: 'Mara', details: 'A cartographer.', appearance: 'Silver hair.' }],
    setting: [{ id: 'city', name: 'The city', details: 'Moves at night.' }],
    chapters: [{
      id: 'chapter-1',
      title: 'Chapter 1',
      synopsis: '',
      story: '',
      summaries: [],
      feedback: [],
      feedbackRevisions: [],
    }],
    activeChapterId: 'chapter-1',
  })

  assert.equal(migrated.schemaVersion, DRAFT_SCHEMA_VERSION)
  assert.deepEqual(migrated.characters, [{
    id: 'mara',
    name: 'Mara',
    details: 'A cartographer.',
    appearance: 'Silver hair.',
    generationPrompt: '',
    characterType: '',
  }])
  assert.deepEqual(migrated.setting, [{
    id: 'city',
    name: 'The city',
    details: 'Moves at night.',
    appearance: '',
    generationPrompt: '',
  }])
})

test('version five drafts retain Lore prompts and gain character types', () => {
  const migrated = migrateDraftData({
    schemaVersion: 5,
    characters: [{
      id: 'mara',
      name: '',
      details: '',
      appearance: '',
      generationPrompt: 'A careful cartographer who distrusts royal maps.',
    }],
    setting: [],
  })
  assert.deepEqual(migrated.characters, [{
    id: 'mara',
    name: '',
    details: '',
    appearance: '',
    generationPrompt: 'A careful cartographer who distrusts royal maps.',
    characterType: '',
  }])
})

test('current drafts stay stable and unsupported future schema versions fail explicitly', () => {
  const current = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    synopsis: 'Keep this',
    characters: [],
    chapters: [{
      id: 'chapter-1',
      title: 'Chapter 1',
      synopsis: '',
      story: '',
      summaries: [],
      feedback: [],
      feedbackRevisions: [],
    }],
    activeChapterId: 'chapter-1',
    structurePrompt: '',
  }
  assert.deepEqual(migrateDraftData(current), current)
  assert.throws(
    () => migrateDraftData({ schemaVersion: DRAFT_SCHEMA_VERSION + 1 }),
    /Unsupported draft schema version/,
  )
})
