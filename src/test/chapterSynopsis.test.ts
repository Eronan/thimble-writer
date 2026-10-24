import assert from 'node:assert/strict'
import test from 'node:test'
import type { StoryChapter } from '../app/types/storyWriter.ts'
import {
  buildAllChapterStructureContext,
  buildChapterSynopsisContext,
  parseChapterStructureResponse,
} from '../app/utils/chapterSynopsis.ts'

function chapter(overrides: Partial<StoryChapter>): StoryChapter {
  return {
    id: 'chapter',
    title: 'Chapter',
    synopsis: '',
    story: '',
    summaries: [],
    feedback: [],
    feedbackRevisions: [],
    ...overrides,
  }
}

test('chapter generator context includes Lore and other synopses, not target story or synopsis', () => {
  const target = chapter({
    id: 'target',
    title: 'The Arrival',
    synopsis: 'Do not use this existing synopsis.',
    story: 'Do not use this story.',
  })
  const prior = chapter({
    id: 'prior',
    title: 'First Contact',
    synopsis: 'Mira meets the people of Xylor.',
  })

  const result = buildChapterSynopsisContext(target, [target, prior], 'Xylor has two moons.', 2000, 'Keep it mysterious.')

  assert.match(result.context, /The Arrival/)
  assert.match(result.context, /First Contact:\nMira meets the people of Xylor\./)
  assert.match(result.context, /Xylor has two moons\./)
  assert.match(result.context, /Keep it mysterious\./)
  assert.doesNotMatch(result.context, /Do not use this/)
  assert.equal(result.clipped, false)
})

test('all-chapter structure context includes every chapter, Lore, and custom direction but no prose', () => {
  const first = chapter({ id: 'one', title: 'First', synopsis: 'The journey begins.', story: 'Draft prose.' })
  const second = chapter({ id: 'two', title: 'Second', synopsis: 'The conflict escalates.' })
  const result = buildAllChapterStructureContext(
    [first, second],
    'The city moves at night.',
    'End on a reveal.',
    4000,
  )

  assert.match(result.context, /First:/)
  assert.match(result.context, /Second:/)
  assert.match(result.context, /The city moves at night\./)
  assert.match(result.context, /End on a reveal\./)
  assert.doesNotMatch(result.context, /Draft prose\./)
  assert.equal(result.clipped, false)
})

test('all-chapter response parser validates existing chapters and accepts added chapters', () => {
  const parsed = parseChapterStructureResponse(JSON.stringify({
    chapters: [
      { title: 'Arrival', synopsis: 'The heroine arrives.' },
      { title: 'Departure', synopsis: 'The group leaves.' },
    ],
  }), 1)
  assert.deepEqual(parsed, [
    { title: 'Arrival', synopsis: 'The heroine arrives.' },
    { title: 'Departure', synopsis: 'The group leaves.' },
  ])
  assert.throws(
    () => parseChapterStructureResponse('{"chapters":[]}', 1),
    /without all existing chapters/,
  )
  assert.throws(
    () => parseChapterStructureResponse('not JSON', 0),
    /invalid structured chapter data/,
  )
})

test('chapter generator context clips to its character budget', () => {
  const target = chapter({ id: 'target', title: 'Arrival' })
  const other = chapter({ id: 'other', title: 'Prior', synopsis: 'A'.repeat(1000) })
  const result = buildChapterSynopsisContext(target, [target, other], 'B'.repeat(1000), 300)

  assert.ok(result.context.length <= 300)
  assert.equal(result.clipped, true)
})
