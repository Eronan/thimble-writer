import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildContextItems,
  formatLoreForPrompt,
  formatSections,
  migrateLoreFields,
  type LegacyLoreFields,
  type LoreFields,
} from '../app/utils/loreWorkspace.ts'

// formatLoreForPrompt works on sections; wrap legacy strings the way the v7 migration does.
function toSections(fields: LegacyLoreFields): LoreFields {
  return {
    synopsisSections: [{ id: 'synopsis-1', title: '', text: fields.synopsis }],
    guidanceSections: [{ id: 'guidance-1', title: '', text: fields.guidance }],
    characters: fields.characters,
    setting: fields.setting,
  }
}

test('legacy freeform lore migrates to story synopsis and retains existing generator prompt', () => {
  const fields = migrateLoreFields({
    lore: 'A cartographer hears the memories of places.',
    prompt: 'Find the hidden door.',
  })
  assert.equal(fields.synopsis, 'A cartographer hears the memories of places.')
  assert.equal(fields.guidance, '')
  assert.deepEqual(fields.characters, [])
  assert.deepEqual(fields.setting, [])
})

test('kind is folded into writing guidance and structured lore takes precedence', () => {
  assert.deepEqual(migrateLoreFields({
    lore: 'Legacy notes',
    synopsis: 'Current synopsis',
    kind: 'Fantasy',
    guidance: 'Keep a gentle tone.',
    characters: [{ id: 'mara', name: 'Mara', details: 'A cartographer.', appearance: 'Silver hair.', characterType: 'protagonist' }],
    setting: [{ id: 'city', name: 'The city', details: 'Moves at night.', appearance: '' }],
  }), {
    synopsis: 'Current synopsis',
    guidance: 'Keep a gentle tone.\n\nFantasy',
    characters: [{ id: 'mara', name: 'Mara', details: 'A cartographer.', appearance: 'Silver hair.', generationPrompt: '', characterType: 'protagonist' }],
    setting: [{ id: 'city', name: 'The city', details: 'Moves at night.', appearance: '', generationPrompt: '' }],
  })
})

test('legacy character and setting notes migrate into editable list entries', () => {
  assert.deepEqual(migrateLoreFields({
    characters: 'Mara is a cartographer.',
    setting: 'The city moves each night.',
  }), {
    synopsis: '',
    guidance: '',
    characters: [{ id: 'legacy-character', name: '', details: 'Mara is a cartographer.', appearance: '', generationPrompt: '', characterType: '' }],
    setting: [{ id: 'legacy-setting', name: '', details: 'The city moves each night.', appearance: '', generationPrompt: '' }],
  })
})

test('character appearance is a separate lore note from core details', () => {
  const fields = migrateLoreFields({
    synopsis: 'A map goes missing.\n\nA city is at risk.',
    guidance: 'Fantasy mystery',
    characters: [{ id: 'mara', name: 'Mara', details: 'Maps the city.', appearance: 'Silver hair.' }],
    setting: [{ id: 'city', name: 'The city', details: 'Moves each night.', appearance: '' }],
  })
  assert.equal(formatLoreForPrompt(toSections(fields)), [
    'A map goes missing.\n\nA city is at risk.',
    'Fantasy mystery',
    'Mara\nMaps the city.',
    'Mara (appearance)\nSilver hair.',
    'The city\nMoves each night.',
  ].join('\n\n'))
})

test('character appearance can be omitted without changing core character notes', () => {
  const fields = migrateLoreFields({
    characters: [{ id: 'mara', name: 'Mara', details: 'Maps the city.' }],
  })
  assert.equal(formatLoreForPrompt(toSections(fields)), 'Mara\nMaps the city.')
})

test('character type is included in formatted lore as a role label', () => {
  const fields = migrateLoreFields({
    characters: [{ id: 'mara', name: 'Mara', characterType: 'protagonist', details: 'Maps the city.' }],
  })
  assert.equal(formatLoreForPrompt(toSections(fields)), 'Mara (protagonist)\nMaps the city.')
})

const sectioned: LoreFields = {
  synopsisSections: [
    { id: 'premise', title: 'Premise', text: 'A map goes missing.' },
    { id: 'ending', title: 'Ending', text: 'The city is saved.' },
  ],
  guidanceSections: [{ id: 'voice', title: '', text: 'Close third person.' }],
  characters: [{ id: 'mara', name: 'Mara', details: 'Maps the city.', appearance: 'Silver hair.' }],
  setting: [{ id: 'city', name: 'The city', details: 'Moves each night.' }],
}

test('sections are sent with their titles and each one is its own selector entry', () => {
  assert.equal(formatLoreForPrompt(sectioned), [
    'Premise\nA map goes missing.',
    'Ending\nThe city is saved.',
    'Close third person.',
    'Mara\nMaps the city.',
    'Mara (appearance)\nSilver hair.',
    'The city\nMoves each night.',
  ].join('\n\n'))
})

test('unticked entries are removed before the lore selector sees them', () => {
  const text = formatLoreForPrompt(sectioned, new Set(['ending', 'mara']))
  assert.equal(text, [
    'Premise\nA map goes missing.',
    'Close third person.',
    'The city\nMoves each night.',
  ].join('\n\n'))
  assert.equal(formatLoreForPrompt(sectioned, new Set(sectioned.synopsisSections.map(s => s.id).concat('voice', 'mara', 'city'))), '')
})

test('context items list every non-empty entry once, in prompt order, with fallback labels', () => {
  const items = buildContextItems({
    ...sectioned,
    synopsisSections: [...sectioned.synopsisSections, { id: 'blank', title: '', text: '   ' }, { id: 'untitled', title: '', text: 'Loose idea.' }],
  })
  assert.deepEqual(items.map(item => [item.id, item.group, item.label]), [
    ['premise', 'synopsis', 'Premise'],
    ['ending', 'synopsis', 'Ending'],
    ['untitled', 'synopsis', 'Synopsis 4'],
    ['voice', 'guidance', 'Guidance 1'],
    ['mara', 'characters', 'Mara'],
    ['city', 'setting', 'The city'],
  ])
  assert.equal(items.find(item => item.id === 'mara')?.text, 'Mara\nMaps the city.\n\nMara (appearance)\nSilver hair.')
})

test('formatSections joins titled sections for whole-story prompts', () => {
  assert.equal(formatSections(sectioned.synopsisSections), 'Premise\nA map goes missing.\n\nEnding\nThe city is saved.')
})
