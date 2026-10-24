import assert from 'node:assert/strict'
import test from 'node:test'
import { formatLoreForPrompt, migrateLoreFields } from '../app/utils/loreWorkspace.ts'

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
  assert.equal(formatLoreForPrompt(fields), [
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
  assert.equal(formatLoreForPrompt(fields), 'Mara\nMaps the city.')
})

test('character type is included in formatted lore as a role label', () => {
  const fields = migrateLoreFields({
    characters: [{ id: 'mara', name: 'Mara', characterType: 'protagonist', details: 'Maps the city.' }],
  })
  assert.equal(formatLoreForPrompt(fields), 'Mara (protagonist)\nMaps the city.')
})
