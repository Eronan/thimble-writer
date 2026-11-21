import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anchorProofreadSuggestions,
  parseProofreadResponse,
  proofreadResponseFormat,
  splitStoryForProofreading,
} from '../app/utils/storyProofread.ts'

test('proofreading chunks preserve exact source offsets and stay within the size limit', () => {
  const story = 'Opening scene.\n\nA long paragraph with several words to split safely.\n\nClosing.'
  const chunks = splitStoryForProofreading(story, 18)
  assert.ok(chunks.length > 2)
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 18)
    assert.equal(story.slice(chunk.start, chunk.start + chunk.text.length), chunk.text)
  }
  assert.throws(() => splitStoryForProofreading(story, 0), RangeError)
})

test('proofreading keeps summarized sections in separate requests and supplies their summaries as context', () => {
  const firstSection = 'Mara found the old map.\n\nIt showed a path to the river.'
  const secondSection = 'At the river, she meet her brother.\n\nThey crossed before dawn.'
  const story = `${firstSection}\n\n${secondSection}`
  const chunks = splitStoryForProofreading(story, 500, [
    { id: 'first', source: firstSection, summary: 'Mara found a map leading to the river.' },
    { id: 'second', source: secondSection, summary: 'Mara reunited with her brother at the river.' },
  ])

  assert.equal(chunks.length, 2)
  assert.deepEqual(chunks[0]?.summaries, ['Mara found a map leading to the river.'])
  assert.deepEqual(chunks[1]?.summaries, [
    'Mara found a map leading to the river.',
    'Mara reunited with her brother at the river.',
  ])
  assert.equal(chunks[0]?.text, firstSection)
  assert.equal(chunks[1]?.text, secondSection)
})

test('the proofread schema asks only for quote, issue and an exact replacement', () => {
  const item = proofreadResponseFormat.properties.comments.items
  assert.deepEqual(item.required, ['quote', 'issue', 'replacement'])
  assert.deepEqual(Object.keys(item.properties), ['quote', 'issue', 'replacement'])
})

test('structured proofread responses parse into comments and reject malformed items', () => {
  assert.equal(proofreadResponseFormat.type, 'object')
  assert.deepEqual(parseProofreadResponse(JSON.stringify({
    comments: [{
      quote: 'a error',
      before: 'There is ',
      after: ' here.',
      issue: 'Incorrect article.',
      replacement: 'an error',
    }],
  })), {
    comments: [{
      quote: 'a error',
      before: 'There is ',
      after: ' here.',
      issue: 'Incorrect article.',
      replacement: 'an error',
    }],
    incomplete: false,
    skipped: 0,
  })
  assert.deepEqual(parseProofreadResponse('```json\n{"comments":[]}\n```'), { comments: [], incomplete: false, skipped: 0 })
  assert.deepEqual(parseProofreadResponse('Here are the comments:\n{"comments":[]}'), { comments: [], incomplete: false, skipped: 0 })
  assert.throws(() => parseProofreadResponse('not json'), /invalid structured/)
  assert.deepEqual(parseProofreadResponse('{"comments":[{"quote":"lost"}]}'), {
    comments: [],
    incomplete: false,
    skipped: 1,
  })
})

test('proofreading skips non-actionable comments and tolerates missing context fields', () => {
  assert.deepEqual(parseProofreadResponse(JSON.stringify({
    comments: [
      { quote: 'No error', issue: 'No error', replacement: '' },
      { quote: 'they was', issue: 'Grammar', replacement: 'they were' },
    ],
  })), {
    comments: [{
      quote: 'they was',
      before: '',
      after: '',
      issue: 'Grammar',
      replacement: 'they were',
    }],
    incomplete: false,
    skipped: 1,
  })
})

test('truncated proofreading output keeps only complete comments', () => {
  const response = `{
    "comments": [
      {
        "quote": "a error",
        "before": "There is ",
        "after": " here.",
        "issue": "Incorrect article",
        "replacement": "an error"
      },
      {
        "quote": "they was",
        "before": "The group said ",
        "after": " ready.",
        "issue": "Subject-verb agreement",
        "replacement": "they were"`
  assert.deepEqual(parseProofreadResponse(response), {
    comments: [{
      quote: 'a error',
      before: 'There is ',
      after: ' here.',
      issue: 'Incorrect article',
      replacement: 'an error',
    }],
    incomplete: true,
    skipped: 0,
  })
})

test('proofread suggestions anchor exactly and use context to disambiguate repeated quotes', () => {
  const chunk = { start: 25, text: 'The red fox ran. The blue fox slept.' }
  const result = anchorProofreadSuggestions(chunk, [
    {
      quote: 'fox',
      before: 'blue ',
      after: ' slept.',
      issue: 'Possible word choice issue.',
      replacement: 'hound',
    },
    {
      quote: 'fox',
      before: '',
      after: '',
      issue: 'Ambiguous quote.',
      replacement: 'revised',
    },
    {
      quote: 'not present',
      before: '',
      after: '',
      issue: 'Unanchored quote.',
      replacement: 'revised',
    },
  ])
  assert.deepEqual(result.comments.map(({ start, end, quote }) => ({ start, end, quote })), [
    { start: 51, end: 54, quote: 'fox' },
  ])
  assert.equal(result.skipped, 2)
})

test('proofreading repairs incorrect context for a unique quote but skips ambiguous matches', () => {
  const chunk = { start: 10, text: 'Before the error happened. Then the error ended.' }
  const result = anchorProofreadSuggestions(chunk, [
    {
      quote: 'happened.',
      before: 'incorrect context',
      after: 'incorrect context',
      issue: 'Wording',
      replacement: 'revised',
    },
    {
      quote: 'the',
      before: 'incorrect context',
      after: 'incorrect context',
      issue: 'Wording',
      replacement: 'revised',
    },
  ])

  assert.deepEqual(result.comments.map(({ start, end, before, after }) => ({
    start,
    end,
    before,
    after,
  })), [{
    start: 27,
    end: 36,
    before: 'Before the error ',
    after: ' Then the error ended.',
  }])
  assert.equal(result.skipped, 1)
})

test('proofread replacements are trimmed and an empty replacement is not a fix', () => {
  const parsed = parseProofreadResponse(JSON.stringify({
    comments: [
      { quote: ' spun ', issue: 'Tense', replacement: ' spins ' },
      { quote: 'fine', issue: 'Nothing', replacement: '   ' },
    ],
  }))
  assert.deepEqual(parsed.comments, [{ quote: 'spun', before: '', after: '', issue: 'Tense', replacement: 'spins' }])
  assert.equal(parsed.skipped, 1)
})

test('a quote that repeats without disambiguating context is skipped rather than guessed', () => {
  const result = anchorProofreadSuggestions(
    { start: 0, text: 'The fox ran. The fox slept.' },
    [{ quote: 'fox', before: '', after: '', issue: 'Word choice', replacement: 'hound' }],
  )
  assert.equal(result.comments.length, 0)
  assert.equal(result.skipped, 1)
})
