import assert from 'node:assert/strict'
import test from 'node:test'
import type { Draft } from '../app/types/storyWriter.ts'
import {
  buildLoreGenerationContext,
  parseGeneratedLoreDetails,
} from '../app/utils/loreGeneration.ts'

const draft = {
  synopsis: 'A cartographer uncovers a moving city.',
  guidance: 'Keep the tone intimate.',
  characters: [],
  setting: [],
} as Pick<Draft, 'synopsis' | 'guidance' | 'characters' | 'setting'>

test('individual lore context includes only the selected entry, story setup, and its prompt', () => {
  const target = {
    id: 'mara',
    name: 'Mara',
    details: 'She maps old streets.',
    appearance: 'Silver hair.',
    characterType: 'protagonist',
    generationPrompt: '',
  }
  const result = buildLoreGenerationContext(
    draft,
    'character',
    target,
    'Give her a secret she is afraid to reveal.',
    2000,
  )

  assert.match(result.context, /Give her a secret/)
  assert.match(result.context, /Mara/)
  assert.match(result.context, /Character type: protagonist/)
  assert.match(result.context, /She maps old streets/)
  assert.match(result.context, /A cartographer uncovers a moving city/)
  assert.equal(result.clipped, false)
})

test('individual lore context rejects empty or over-budget prompts explicitly', () => {
  const target = { id: 'place', name: '', details: '' }
  assert.throws(
    () => buildLoreGenerationContext(draft, 'setting', target, '', 2000),
    /Enter a prompt/,
  )
  assert.throws(
    () => buildLoreGenerationContext(draft, 'setting', target, 'A'.repeat(1000), 100),
    /exceed the available model context/,
  )
})

test('generated character and setting details parse from the expected structured shapes', () => {
  assert.deepEqual(parseGeneratedLoreDetails(
    '{"name":"Mara","details":"A cartographer.","appearance":"Silver hair.","characterType":"protagonist"}',
    'character',
  ), {
    name: 'Mara',
    details: 'A cartographer.',
    appearance: 'Silver hair.',
    characterType: 'protagonist',
  })
  assert.deepEqual(parseGeneratedLoreDetails(
    '{"name":"The Moving City","details":"Its streets rearrange each night."}',
    'setting',
  ), {
    name: 'The Moving City',
    details: 'Its streets rearrange each night.',
  })
  assert.throws(
    () => parseGeneratedLoreDetails('{"name":"Mara","details":""}', 'character'),
    /incomplete structured lore data/,
  )
})
