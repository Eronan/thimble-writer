import assert from 'node:assert/strict'
import test from 'node:test'
import { getFeedbackDiff, getFeedbackDiffLines, locateFeedback } from '../app/utils/storyFeedback.ts'

test('character diff preserves context and isolates changed text', () => {
  assert.deepEqual(getFeedbackDiff('The quick brown fox.', 'The quick red fox.'), [
    { type: 'equal', value: 'The quick ' },
    { type: 'removed', value: 'b' },
    { type: 'equal', value: 'r' },
    { type: 'removed', value: 'own' },
    { type: 'added', value: 'ed' },
    { type: 'equal', value: ' fox.' },
  ])
})

test('character diff handles Unicode code points and identical text', () => {
  assert.deepEqual(getFeedbackDiff('a🙂b', 'a😎b'), [
    { type: 'equal', value: 'a' },
    { type: 'removed', value: '🙂' },
    { type: 'added', value: '😎' },
    { type: 'equal', value: 'b' },
  ])
  assert.deepEqual(getFeedbackDiff('unchanged', 'unchanged'), [
    { type: 'equal', value: 'unchanged' },
  ])
})

test('line diff omits blank lines and ignores whitespace-only differences', () => {
  assert.deepEqual(getFeedbackDiffLines('Jessica   cried out.\n\n\nNext.', 'Jessica cried out.\n\nNext.'), [
    { before: 'Jessica cried out.', after: 'Jessica cried out.', changed: false, runs: [] },
    { before: 'Next.', after: 'Next.', changed: false, runs: [] },
  ])
})

test('line diff pairs replacement lines and highlights characters within the pair', () => {
  const lines = getFeedbackDiffLines('Start.\nJessica cried.\nEnd.', 'Start.\nJessica laughed.\nEnd.')
  assert.deepEqual(lines.map(({ before, after, changed }) => ({ before, after, changed })), [
    { before: 'Start.', after: 'Start.', changed: false },
    { before: 'Jessica cried.', after: 'Jessica laughed.', changed: true },
    { before: 'End.', after: 'End.', changed: false },
  ])
  assert.equal(lines[1]?.runs.filter(run => run.type === 'removed').map(run => run.value).join(''), 'cri')
  assert.equal(lines[1]?.runs.filter(run => run.type === 'added').map(run => run.value).join(''), 'laugh')
})

test('line diff marks pure insertion and deletion with an empty opposite side', () => {
  assert.deepEqual(
    getFeedbackDiffLines('Opening.\nClosing.', 'Opening.\nInserted.\nClosing.')
      .map(({ before, after }) => [before, after]),
    [['Opening.', 'Opening.'], [null, 'Inserted.'], ['Closing.', 'Closing.']],
  )
  assert.deepEqual(
    getFeedbackDiffLines('Opening.\nRemoved.\nClosing.', 'Opening.\nClosing.')
      .map(({ before, after }) => [before, after]),
    [['Opening.', 'Opening.'], ['Removed.', null], ['Closing.', 'Closing.']],
  )
})

test('feedback target uses offset first, then surrounding anchors and nearest match', () => {
  const comment = {
    id: 'comment',
    start: 30,
    source: 'echo',
    before: 'Near ',
    after: ' end',
    instruction: 'Revise it',
  }
  const story = 'Near echo end. Far echo end.'
  assert.deepEqual(locateFeedback(story, comment), { start: 5, end: 9 })
  assert.deepEqual(locateFeedback('Near echo end.', { ...comment, start: 5 }), { start: 5, end: 9 })
  assert.equal(locateFeedback('No matching source.', comment), null)
})
