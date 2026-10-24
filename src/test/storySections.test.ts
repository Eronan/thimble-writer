import assert from 'node:assert/strict'
import test from 'node:test'
import { locateSection, paragraphsWithOffsets, planStorySections } from '../app/utils/storySections.ts'

test('paragraph extraction preserves text and source offsets', () => {
  assert.deepEqual(paragraphsWithOffsets('First paragraph.\n\n  Second paragraph.  '), [
    { text: 'First paragraph.', start: 0, end: 16 },
    { text: 'Second paragraph.  ', start: 20, end: 39 },
  ])
})

test('section lookup detects exact sources and edited multi-paragraph anchors', () => {
  const firstParagraph = 'First scene starts here and continues for many words to preserve a stable anchor.'
  const secondParagraph = 'Second scene starts here and continues for many words to preserve a stable anchor.'
  const section = { id: 'section', source: `${firstParagraph}\n\n${secondParagraph}`, summary: 'Two scenes.' }
  assert.deepEqual(locateSection(`Intro.\n\n${section.source}\n\nEnd.`, section), {
    start: 8,
    end: 8 + section.source.length,
    stale: false,
  })
  const revisedFirst = `${firstParagraph.slice(0, 55)}was revised${firstParagraph.slice(55)}`
  const revisedStory = `${revisedFirst}\n\n${secondParagraph}`
  assert.deepEqual(locateSection(revisedStory, section), {
    start: 0,
    end: revisedStory.length,
    stale: true,
  })
  assert.equal(locateSection('A replacement single paragraph.', {
    id: 'single',
    source: 'Original single paragraph.',
    summary: 'Old.',
  }), null)
})

test('section planning groups old paragraphs and retains the newest paragraph', () => {
  assert.deepEqual(planStorySections('One.\n\nTwo.\n\nThree.\n\nFour.', [], 1, 2, true), [
    'One.\n\nTwo.',
    'Three.',
  ])
})

test('scene dividers split summary groups and are not summarized', () => {
  assert.deepEqual(planStorySections('One.\n\n***\n\nTwo.\n\nNewest.', [], 1, 4, true), [
    'One.',
    'Two.',
  ])
})

test('already summarized paragraphs are not scheduled again', () => {
  const summaries = [{ id: 's1', source: 'One.\n\nTwo.', summary: 'A summary.' }]
  assert.deepEqual(planStorySections('One.\n\nTwo.\n\nThree.\n\nNewest.', summaries, 1, 4, true), [
    'Three.',
  ])
})

test('source-size cap splits sections before a request gets too large', () => {
  assert.deepEqual(planStorySections('12345\n\n67890\n\nnewest', [], 1, 5, true, 7), [
    '12345',
    '67890',
  ])
})
