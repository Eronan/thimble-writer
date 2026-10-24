import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStoryContext } from '../app/utils/storyPrompt.ts'

test('context keeps recent prose verbatim and includes summaries for older sections', () => {
  const story = 'Old opening.\n\nOld discovery.\n\nRecent scene begins.\n\nLatest line.'
  const context = buildStoryContext({
    lore: 'Mara maps old places.',
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
  assert.equal(context.budget.storyChars, context.story.length)
  assert.equal(context.budget.summaryChars, context.summaries.length)
  assert.equal(context.budget.loreLimitChars, context.loreBudget)
})

test('context marks same-line continuation separately from a new line', () => {
  const base = {
    lore: '',
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
