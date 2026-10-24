import assert from 'node:assert/strict'
import test from 'node:test'
import { describeWordDelta, getStoryDiff } from '../app/utils/storyDiff.ts'

const paragraphs = (count: number) => Array.from({ length: count }, (_, i) => `Paragraph ${i + 1} of the story.`).join('\n\n')

test('story diff of identical text reports no changes', () => {
  const diff = getStoryDiff(paragraphs(3), paragraphs(3))
  assert.equal(diff.identical, true)
  assert.equal(diff.stats.wordDelta, 0)
  assert.equal(diff.items.every(item => item.kind === 'gap'), true)
})

test('a written paragraph shows as an addition with a word count', () => {
  const before = paragraphs(2)
  const after = `${before}\n\nThe keeper climbed the stairs.`
  const diff = getStoryDiff(before, after)
  assert.equal(diff.identical, false)
  assert.equal(diff.stats.addedParagraphs, 1)
  assert.equal(diff.stats.wordDelta, 5)
  const added = diff.items.find(item => item.kind === 'pair' && item.type === 'added')
  assert.ok(added && added.kind === 'pair')
  assert.equal(added.pair.after, 'The keeper climbed the stairs.')
  assert.equal(added.pair.before, null)
})

test('continuing the last paragraph shows as a changed paragraph with highlighted additions', () => {
  const before = 'She opened the door.'
  const after = 'She opened the door. Cold air rushed in.'
  const diff = getStoryDiff(before, after)
  assert.equal(diff.stats.changedParagraphs, 1)
  const changed = diff.items.find(item => item.kind === 'pair' && item.type === 'changed')
  assert.ok(changed && changed.kind === 'pair')
  const addedText = changed.pair.runs.filter(run => run.type === 'added').map(run => run.value).join('')
  assert.match(addedText, /Cold air rushed in/)
})

test('unchanged paragraphs far from a change collapse into a gap', () => {
  const before = paragraphs(10)
  const after = before.replace('Paragraph 5 of the story.', 'Paragraph five was rewritten.')
  const diff = getStoryDiff(before, after, 1)
  const gaps = diff.items.filter(item => item.kind === 'gap')
  assert.equal(gaps.length, 2)
  assert.equal(gaps[0]!.kind === 'gap' && gaps[0]!.count, 3)
  assert.equal(gaps[1]!.kind === 'gap' && gaps[1]!.count, 4)
  const shown = diff.items.filter(item => item.kind === 'pair')
  assert.equal(shown.length, 3)
})

test('removed text is reported as removed paragraphs', () => {
  const diff = getStoryDiff(paragraphs(3), paragraphs(2))
  assert.equal(diff.stats.removedParagraphs, 1)
  assert.ok(diff.stats.wordDelta < 0)
})

test('describeWordDelta uses plain wording', () => {
  assert.equal(describeWordDelta(0), 'no change in word count')
  assert.equal(describeWordDelta(1), '+1 word')
  assert.equal(describeWordDelta(-12), '−12 words')
})
