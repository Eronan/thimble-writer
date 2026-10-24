import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fitLoreEntries,
  parseLoreSelectionResponse,
  prepareLoreEntries,
  splitLoreEntries,
} from '../app/utils/storyLore.ts'

test('lore selector receives every note, clipping entries to fit its input budget', () => {
  const lore = Array.from({ length: 40 }, (_, index) =>
    `Character ${index + 1}: ${'Detailed background. '.repeat(20)}`,
  ).join('\n\n')
  const prepared = prepareLoreEntries(lore, 2400)
  assert.equal(prepared.entries.length, 40)
  assert.ok(prepared.text.length <= 2400)
  for (let number = 1; number <= 40; number++) {
    assert.ok(prepared.text.includes(`[${number}]`))
  }
  assert.match(prepared.text, /\[clipped\]/)
})

test('lore entries parse by blank-line boundaries and selected entries fit whole', () => {
  const entries = splitLoreEntries('  First fact.  \n\n\n Second fact.\nDetail. ')
  assert.deepEqual(entries, [
    { number: 1, text: 'First fact.' },
    { number: 2, text: 'Second fact.\nDetail.' },
  ])
  assert.deepEqual(parseLoreSelectionResponse('{"entries":[2,1,2,99]}', entries), [2, 1])
  assert.deepEqual(fitLoreEntries(entries, [2, 1], 14), {
    text: 'First fact.',
    omitted: 1,
  })
  assert.throws(() => prepareLoreEntries('Fact.', 1), RangeError)
  assert.throws(() => parseLoreSelectionResponse('invalid', entries), /invalid structured/)
})
