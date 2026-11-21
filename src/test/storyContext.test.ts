import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStoryContext, makeStoryRequest } from '../app/utils/storyPrompt.ts'

test('context keeps recent prose verbatim and includes summaries for older sections', () => {
  const story = 'Old opening.\n\nOld discovery.\n\nRecent scene begins.\n\nLatest line.'
  const context = buildStoryContext({
    lore: 'Mara maps old places.',
    chapterSynopsis: 'Mara must find the atlas.',
    prompt: 'Find the door.',
    story,
    summaries: [{
      id: 'old',
      source: 'Old opening.\n\nOld discovery.',
      summary: 'Mara learned the map remembers its makers.',
    }],
    maxTokens: 300,
    numCtx: 4096,
    writerParagraphs: 2,
  })

  assert.equal(context.story, 'Recent scene begins.\n\nLatest line.')
  assert.equal(context.summaries, '- Mara learned the map remembers its makers.')
  assert.equal(context.lore, '')
  assert.ok(context.loreBudget > 0)
  assert.equal(context.continueCurrentParagraph, true)
  assert.equal(context.chapterSynopsis, 'Mara must find the atlas.')
  assert.equal(context.budget.chapterSynopsisChars, context.chapterSynopsis.length)
  assert.equal(context.budget.storyChars, context.story.length)
  assert.equal(context.budget.summaryChars, context.summaries.length)
  assert.equal(context.budget.loreLimitChars, context.loreBudget)
})

test('context marks same-line continuation separately from a new line', () => {
  const base = {
    lore: '',
    chapterSynopsis: '',
    prompt: '',
    summaries: [],
    maxTokens: 300,
    numCtx: 4096,
    writerParagraphs: 3,
  }
  assert.equal(buildStoryContext({ ...base, story: 'An unfinished sentence' }).continueCurrentParagraph, true)
  assert.equal(buildStoryContext({ ...base, story: 'A finished paragraph.\n' }).continueCurrentParagraph, false)
})

test('context budget stays finite for a large lore document and small model window', () => {
  const lore = 'World fact. '.repeat(1000)
  const context = buildStoryContext({
    lore,
    chapterSynopsis: '',
    prompt: 'Continue.',
    story: 'Recent.',
    summaries: [],
    maxTokens: 100,
    numCtx: 512,
    writerParagraphs: 1,
  })
  assert.ok(context.lore.length < lore.length)
  assert.ok(context.story.length < 20)
})

test('chapter synopsis is supplied to both chat and generate story requests', () => {
  const context = buildStoryContext({
    lore: '',
    chapterSynopsis: 'Mara must return the stolen atlas.',
    prompt: '',
    story: '',
    summaries: [],
    maxTokens: 300,
    numCtx: 4096,
    writerParagraphs: 3,
  })
  const request = {
    prompt: '',
    story: '',
    temperature: 0.8,
    maxTokens: 300,
    numCtx: 4096,
    repeatPenalty: 1.1,
  }
  const chatRequest = makeStoryRequest({ ...request, mode: 'instruct' }, context)
  assert.equal(chatRequest.kind, 'chat')
  if (chatRequest.kind === 'chat') {
    assert.match(chatRequest.messages[0]?.content ?? '', /Current chapter synopsis:\nMara must return the stolen atlas\./)
  }
  const generateRequest = makeStoryRequest({ ...request, mode: 'continue' }, context)
  assert.equal(generateRequest.kind, 'generate')
  if (generateRequest.kind === 'generate') {
    assert.match(generateRequest.prompt, /\[Current chapter synopsis\]\nMara must return the stolen atlas\./)
  }
})

const contextBase = {
  lore: '',
  chapterSynopsis: '',
  prompt: '',
  maxTokens: 300,
  numCtx: 4096,
  writerParagraphs: 3,
}

test('single-newline paragraphs (the app\'s own separator) are passed through, even with summaries', () => {
  const story = ['P1 alpha.', 'P2 beta.', 'P3 gamma.', 'P4 delta.', 'P5 epsilon.'].join('\n')
  const context = buildStoryContext({
    ...contextBase,
    story,
    summaries: [{ id: 'a', source: 'P1 alpha.\nP2 beta.', summary: 'Early events.' }],
  })
  assert.equal(context.story, 'P3 gamma.\nP4 delta.\nP5 epsilon.')
  assert.equal(context.summaries, '- Early events.')
})

test('a story shorter than the recent window is sent verbatim instead of being replaced by summaries', () => {
  const context = buildStoryContext({
    ...contextBase,
    story: 'A one.\n\nB two.',
    summaries: [{ id: 'b', source: 'A one.', summary: 'A happened.' }],
  })
  assert.equal(context.story, 'A one.\n\nB two.')
  assert.equal(context.summaries, '')
})

test('the newest paragraphs stay verbatim even when a summary exists for them', () => {
  const story = 'One.\n\nTwo.\n\nThree.\n\nFour.'
  const context = buildStoryContext({
    ...contextBase,
    writerParagraphs: 2,
    story,
    summaries: [{ id: 's', source: 'Three.\n\nFour.', summary: 'Late events.' }],
  })
  assert.equal(context.story, 'One.\n\nTwo.\n\nThree.\n\nFour.')
  assert.equal(context.summaries, '')
})

test('paragraphs that no section covers are included alongside the recent window', () => {
  const story = 'Old one.\n\nOld two.\n\nGap three.\n\nGap four.\n\nRecent five.\n\nRecent six.'
  const context = buildStoryContext({
    ...contextBase,
    writerParagraphs: 2,
    story,
    summaries: [{ id: 's', source: 'Old one.\n\nOld two.', summary: 'Opening.' }],
  })
  assert.equal(context.story, 'Gap three.\n\nGap four.\n\nRecent five.\n\nRecent six.')
  assert.equal(context.summaries, '- Opening.')
})

test('a summary straddling the recent window is dropped and its older paragraphs stay as prose', () => {
  const story = 'One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.'
  const context = buildStoryContext({
    ...contextBase,
    writerParagraphs: 2,
    story,
    summaries: [{ id: 's', source: 'Two.\n\nThree.\n\nFour.', summary: 'Middle.' }],
  })
  assert.equal(context.summaries, '')
  assert.equal(context.story, story)
})

test('summaries fill from the bottom up: the oldest are dropped first when space runs out', () => {
  const paragraph = (label: string) => `${label} ${'word '.repeat(10)}`.trim()
  const sources = ['a', 'b', 'c', 'd'].map(paragraph)
  const story = [...sources, paragraph('recent')].join('\n\n')
  const summaries = sources.map((source, index) => ({
    id: String(index),
    source,
    summary: `Summary ${'xyz '.repeat(20)}${index}`.trim(),
  }))
  const full = buildStoryContext({ ...contextBase, writerParagraphs: 1, story, summaries })
  assert.equal(full.budget.summarySections, 4)

  // Shrink the window until only some summaries fit.
  let trimmed = full
  for (let numCtx = 4096; numCtx > 0 && trimmed.budget.summarySections === 4; numCtx -= 5) {
    trimmed = buildStoryContext({ ...contextBase, numCtx, writerParagraphs: 1, story, summaries })
  }
  assert.ok(trimmed.budget.summarySections > 0 && trimmed.budget.summarySections < 4)
  assert.ok(trimmed.budget.summarySectionsOmitted > 0)
  assert.match(trimmed.summaries, /3$/)
  assert.doesNotMatch(trimmed.summaries, /0$/m)
})

test('an oversized final paragraph is clipped from the front instead of being dropped', () => {
  const context = buildStoryContext({
    ...contextBase,
    numCtx: 1024,
    maxTokens: 300,
    story: `Intro.\n\n${'x'.repeat(20000)}END`,
    summaries: [],
  })
  assert.ok(context.story.endsWith('END'))
  // The giant paragraph is clipped to the story limit; leftover budget may still add Intro.
  assert.ok(context.story.length < 20000)
  assert.ok(context.story.length <= context.budget.inputChars)
  assert.equal(context.budget.storyChars, context.story.length)
})
