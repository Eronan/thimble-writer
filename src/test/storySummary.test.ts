import assert from 'node:assert/strict'
import test from 'node:test'
import { makeSummaryMessages, selectSummaryContext, summarySystem } from '../app/utils/storySummary.ts'
import { planStorySectionRanges, planStorySections } from '../app/utils/storySections.ts'
import { summaryRequestBudget, summarySourceBudget } from '../app/utils/contextBudget.ts'
import { buildStoryContext } from '../app/utils/storyPrompt.ts'

test('summary request separates background from the section to summarize', () => {
  const [system, user] = makeSummaryMessages('Mara opened the door.', ['- Mara found the key.', '- Tom left town.'])
  assert.equal(system?.content, summarySystem)
  const content = user?.content ?? ''
  const backgroundAt = content.indexOf('BACKGROUND')
  const sectionAt = content.indexOf('SECTION TO SUMMARIZE:')
  assert.ok(backgroundAt >= 0 && sectionAt > backgroundAt)
  // Earlier summaries live only in the background block; the section text only in its own block.
  assert.ok(content.slice(backgroundAt, sectionAt).includes('Mara found the key.'))
  assert.ok(!content.slice(sectionAt).includes('Mara found the key.'))
  assert.ok(!content.slice(backgroundAt, sectionAt).includes('Mara opened the door.'))
  assert.match(content, /"""\nMara opened the door\.\n"""/)
})

test('the first section is summarized without an empty background block', () => {
  const [, user] = makeSummaryMessages('First scene.', [])
  assert.ok(!user?.content.includes('BACKGROUND'))
  assert.match(user?.content ?? '', /SECTION TO SUMMARIZE:/)
})

test('background is only earlier sections, in story order, regardless of array order', () => {
  const story = 'Alpha one.\n\nBeta two.\n\nGamma three.\n\nDelta four.'
  const summaries = [
    { id: 'g', source: 'Gamma three.', summary: 'Gamma happened.' },
    { id: 'a', source: 'Alpha one.', summary: 'Alpha happened.' },
    { id: 'd', source: 'Delta four.', summary: 'Delta happened.' },
    { id: 'b', source: 'Beta two.', summary: 'Beta happened.' },
  ]
  const beforeDelta = story.indexOf('Delta four.')
  assert.deepEqual(selectSummaryContext(story, summaries, beforeDelta, 1000), [
    '- Alpha happened.',
    '- Beta happened.',
    '- Gamma happened.',
  ])
  assert.deepEqual(selectSummaryContext(story, summaries, 0, 1000), [])
})

test('when background space is short the nearest earlier sections are kept', () => {
  const story = 'One.\n\nTwo.\n\nThree.\n\nFour.'
  const summaries = ['One', 'Two', 'Three'].map((word, index) => ({
    id: String(index), source: `${word}.`, summary: `${word} summary.`,
  }))
  const context = selectSummaryContext(story, summaries, story.indexOf('Four.'), 31)
  assert.deepEqual(context, ['- Two summary.', '- Three summary.'])
})

test('planned sections report their position in the story', () => {
  const story = 'One.\n\nTwo.\n\nThree.\n\nFour.'
  const planned = planStorySectionRanges(story, [], 1, 2, true)
  assert.deepEqual(planned.map(section => section.text), ['One.\n\nTwo.', 'Three.'])
  for (const section of planned) assert.equal(story.slice(section.start, section.end), section.text)
  assert.deepEqual(planStorySections(story, [], 1, 2, true), planned.map(section => section.text))
})

test('re-summarizing from scratch plans every older section, ignoring none as already covered', () => {
  const story = 'One.\n\nTwo.\n\nThree.\n\nNewest.'
  const existing = [{ id: 's', source: 'One.\n\nTwo.', summary: 'Old.' }]
  assert.deepEqual(planStorySections(story, existing, 1, 4, true), ['Three.'])
  assert.deepEqual(planStorySections(story, [], 1, 4, true), ['One.\n\nTwo.\n\nThree.'])
})

test('summary budget leaves room for background without exceeding the summarizer input', () => {
  for (const numCtx of [256, 1024, 4096, 8192]) {
    const budget = summaryRequestBudget(numCtx)
    assert.equal(budget.inputChars, summarySourceBudget(numCtx))
    assert.equal(budget.sourceChars + budget.contextChars + budget.referenceChars, budget.inputChars)
    assert.ok(budget.sourceChars > 0)
  }
  assert.ok(summaryRequestBudget(4096).contextChars > 0)
  assert.ok(summaryRequestBudget(4096).referenceChars > 0)
})

test('story context orders summaries by story position, not by creation order', () => {
  const story = 'Old A.\n\nOld B.\n\nRecent.'
  const context = buildStoryContext({
    lore: '', chapterSynopsis: '', prompt: '', story, maxTokens: 300, numCtx: 4096, writerParagraphs: 1,
    summaries: [
      { id: 'b', source: 'Old B.', summary: 'B happened.' },
      { id: 'a', source: 'Old A.', summary: 'A happened.' },
    ],
  })
  assert.equal(context.summaries, '- A happened.\n- B happened.')
})

test('reference lore sits in its own block, apart from the background and the section', () => {
  const [, user] = makeSummaryMessages(
    'She opened the door.',
    ['- The crew reached the harbour.'],
    ['- Character · Mara: A navigator. She/her.'],
  )
  const content = user?.content ?? ''
  const referenceAt = content.indexOf('REFERENCE')
  const backgroundAt = content.indexOf('BACKGROUND')
  const sectionAt = content.indexOf('SECTION TO SUMMARIZE:')
  assert.ok(referenceAt >= 0 && backgroundAt > referenceAt && sectionAt > backgroundAt)
  assert.ok(content.slice(referenceAt, backgroundAt).includes('A navigator. She/her.'))
  assert.ok(!content.slice(backgroundAt).includes('A navigator'))
  assert.ok(!content.slice(0, sectionAt).includes('She opened the door.'))
  assert.match(summarySystem, /REFERENCE:/)
})

test('without reference lines there is no empty reference block', () => {
  const [, user] = makeSummaryMessages('Text.', ['- Earlier.'], [])
  assert.ok(!user?.content.includes('REFERENCE'))
  assert.ok(user?.content.includes('BACKGROUND'))
})
