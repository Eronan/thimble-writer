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

test('structured proofread responses parse into comments and reject malformed items', () => {
  assert.equal(proofreadResponseFormat.type, 'object')
  assert.deepEqual(parseProofreadResponse(JSON.stringify({
    comments: [{
      quote: 'a error',
      before: 'There is ',
      after: ' here.',
      issue: 'Incorrect article.',
      suggestion: 'Replace with “an error”.',
    }],
  })), {
    comments: [{
      quote: 'a error',
      before: 'There is ',
      after: ' here.',
      issue: 'Incorrect article.',
      suggestion: 'Replace with “an error”.',
    }],
    incomplete: false,
  })
  assert.deepEqual(parseProofreadResponse('```json\n{"comments":[]}\n```'), { comments: [], incomplete: false })
  assert.deepEqual(parseProofreadResponse('Here are the comments:\n{"comments":[]}'), { comments: [], incomplete: false })
  assert.throws(() => parseProofreadResponse('not json'), /invalid structured/)
  assert.throws(() => parseProofreadResponse('{"comments":[{"quote":"lost"}]}'), /incomplete/)
})

test('truncated proofreading output keeps only complete comments', () => {
  const response = `{
    "comments": [
      {
        "quote": "a error",
        "before": "There is ",
        "after": " here.",
        "issue": "Incorrect article",
        "suggestion": "Change to an error."
      },
      {
        "quote": "they was",
        "before": "The group said ",
        "after": " ready.",
        "issue": "Subject-verb agreement",
        "suggestion": "Change to they were"`
  assert.deepEqual(parseProofreadResponse(response), {
    comments: [{
      quote: 'a error',
      before: 'There is ',
      after: ' here.',
      issue: 'Incorrect article',
      suggestion: 'Change to an error.',
    }],
    incomplete: true,
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
      suggestion: 'Consider another word.',
    },
    {
      quote: 'fox',
      before: '',
      after: '',
      issue: 'Ambiguous quote.',
      suggestion: 'Revise it.',
    },
    {
      quote: 'not present',
      before: '',
      after: '',
      issue: 'Unanchored quote.',
      suggestion: 'Revise it.',
    },
  ])
  assert.deepEqual(result.comments.map(({ start, end, quote }) => ({ start, end, quote })), [
    { start: 51, end: 54, quote: 'fox' },
  ])
  assert.equal(result.skipped, 2)
})
