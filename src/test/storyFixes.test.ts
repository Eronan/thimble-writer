import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyFixesToStory,
  checkFixReplacement,
  isFix,
  splitFeedback,
  type StoryFix,
} from '../app/utils/storyFixes.ts'
import type { StoryFeedback } from '../app/utils/storyFeedback.ts'

function fix(story: string, source: string, replacement: string, id = source): StoryFix {
  const start = story.indexOf(source)
  return {
    id,
    kind: 'fix',
    start,
    source,
    replacement,
    before: story.slice(Math.max(0, start - 80), start),
    after: story.slice(start + source.length, start + source.length + 80),
    instruction: 'Issue.',
  }
}

test('fix and comment feedback are told apart, and old or malformed items count as comments', () => {
  const comment: StoryFeedback = { id: 'c', start: 0, source: 'a', before: '', after: '', instruction: 'Tighten.' }
  const legacy: StoryFeedback = { ...comment, id: 'legacy' }
  const malformed: StoryFeedback = { ...comment, id: 'bad', kind: 'fix' }
  const real: StoryFeedback = { ...comment, id: 'f', kind: 'fix', replacement: 'b' }
  assert.equal(isFix(real), true)
  assert.equal(isFix(comment), false)
  assert.equal(isFix(legacy), false)
  assert.equal(isFix(malformed), false)
  const { fixes, comments } = splitFeedback([comment, legacy, malformed, real])
  assert.deepEqual(fixes.map(item => item.id), ['f'])
  assert.deepEqual(comments.map(item => item.id), ['c', 'legacy', 'bad'])
})

test('replacement checks accept local corrections and reject rewrites', () => {
  assert.equal(checkFixReplacement('they was', 'they were'), null)
  assert.equal(checkFixReplacement('spun, disoriented by the darkness', 'spins, disoriented by the darkness'), null)
  assert.equal(checkFixReplacement('they was', 'they was'), 'unchanged')
  // A whole new paragraph in place of a short quote
  assert.equal(checkFixReplacement('spun', 'My head spins.\n\nThe darkness shifted around us as we ran.'), 'line-break')
  assert.equal(checkFixReplacement('spun', 'My head spins, disoriented by the darkness shifting around us and the cold.'), 'size')
  // Most of a long quote thrown away
  const longQuote = 'My head spun, disoriented by the darkness shifting around us.'
  assert.equal(checkFixReplacement(longQuote, 'Spins.'), 'size')
  assert.equal(checkFixReplacement('x'.repeat(301), 'y'), 'quote-too-long')
  // A line break already in the quote may stay
  assert.equal(checkFixReplacement('one\ntwo', 'one\nthree'), null)
})

test('applying fixes changes only the quoted text, however many fixes there are', () => {
  const story = 'The group said they was ready.\n\nMara spun around, and her head spun.\n\nThey left.'
  const fixes = [
    fix(story, 'they was', 'they were'),
    fix(story, 'her head spun', 'her head spun faster'),
  ]
  const result = applyFixesToStory(story, fixes)
  assert.equal(
    result.story,
    'The group said they were ready.\n\nMara spun around, and her head spun faster.\n\nThey left.',
  )
  assert.deepEqual(result.failed, [])
  assert.deepEqual(result.applied.map(item => [item.before, item.after]), [
    ['they was', 'they were'],
    ['her head spun', 'her head spun faster'],
  ])
  // Length changes by exactly the sum of the replacements' size differences: nothing else moved.
  const delta = ('they were'.length - 'they was'.length) + ('her head spun faster'.length - 'her head spun'.length)
  assert.equal(result.story.length, story.length + delta)
  assert.equal(result.story.split('\n\n').length, story.split('\n\n').length)
})

test('fix order and earlier replacements do not disturb later fixes', () => {
  const story = 'aa bb cc dd'
  const fixes = [fix(story, 'dd', 'DDDD'), fix(story, 'aa', 'A'), fix(story, 'cc', 'C')]
  assert.equal(applyFixesToStory(story, fixes).story, 'A bb C DDDD')
})

test('a fix whose passage is gone, or that collides with another fix, is reported and not applied', () => {
  const story = 'One two three four.'
  const missing: StoryFix = { ...fix(story, 'two', 'TWO', 'missing'), source: 'gone', start: 4 }
  const first = fix(story, 'two three', 'Two Three', 'first')
  const overlapping = fix(story, 'three four', 'Three Four', 'overlap')
  const result = applyFixesToStory(story, [missing, first, overlapping])
  assert.equal(result.story, 'One Two Three four.')
  assert.deepEqual(result.applied.map(item => item.id), ['first'])
  assert.deepEqual([...result.failed].sort(), ['missing', 'overlap'])
})

test('a fix still finds its passage after the story shifted around it', () => {
  const original = 'Intro.\n\nThey was late.'
  const queued = fix(original, 'They was', 'They were')
  const edited = `A new opening paragraph.\n\n${original}`
  assert.equal(applyFixesToStory(edited, [queued]).story, 'A new opening paragraph.\n\nIntro.\n\nThey were late.')
})
