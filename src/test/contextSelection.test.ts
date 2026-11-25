import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyContextSelection,
  buildContextSelectionRequest,
  contextSelectionResponseFormat,
  contextSelectionSystem,
  parseContextSelectionResponse,
  type ContextSelectionInput,
} from '../app/utils/contextSelection.ts'
import { buildContextItems, type ContextItem } from '../app/utils/loreWorkspace.ts'

const items: ContextItem[] = [
  { id: 'syn', group: 'synopsis', label: 'Premise', text: 'A ship is lost in a nebula.' },
  { id: 'guide', group: 'guidance', label: 'Voice', text: 'Terse, present tense.' },
  { id: 'mara', group: 'characters', label: 'Mara', text: 'Mara\nA navigator\n\nwith a limp.' },
  { id: 'bridge', group: 'setting', label: 'The bridge', text: 'Cramped, lit red.' },
]

const base: ContextSelectionInput = {
  items,
  story: 'P1 old.\nP2 older.\nP3 mid.\nP4 near.\nP5 newest.',
  summaries: [],
  prompt: 'Mara reaches the bridge.',
  chapterSynopsis: 'The crew searches for a way out.',
  writerParagraphs: 3,
  numCtx: 4096,
}

test('the request lists every entry, numbered and grouped, apart from the story it is judged against', () => {
  const { messages } = buildContextSelectionRequest(base)
  assert.equal(messages[0]?.content, contextSelectionSystem)
  const user = messages[1]?.content ?? ''
  const listAt = user.indexOf('Numbered setup entries:')
  assert.ok(listAt > 0)
  const list = user.slice(listAt)
  assert.match(list, /\[1\] Synopsis · Premise: A ship is lost in a nebula\./)
  assert.match(list, /\[2\] Writing guidance · Voice: /)
  assert.match(list, /\[3\] Character · Mara: A navigator with a limp\./)
  assert.match(list, /\[4\] Setting · The bridge: Cramped, lit red\./)
  // Story-side material is never inside the entries list, and entries never leak above it.
  const storySide = user.slice(0, listAt)
  assert.match(storySide, /Writing direction for the next passage:\nMara reaches the bridge\./)
  assert.match(storySide, /Chapter synopsis:\nThe crew searches/)
  assert.doesNotMatch(storySide, /nebula|limp/)
  assert.doesNotMatch(list, /P5 newest/)
})

test('only the latest writer paragraphs and the last few scenes are used', () => {
  const story = 'P1 old.\nP2 older.\nP3 mid.\nP4 near.\nP5 newest.'
  const summaries = ['One', 'Two', 'Three', 'Four'].map((word, index) => ({
    id: String(index), source: `S${index}`, summary: `${word} happened.`,
  }))
  const withScenes = `S0\nS1\nS2\nS3\n${story}`
  const user = buildContextSelectionRequest({ ...base, story: withScenes, summaries }).messages[1]?.content ?? ''
  assert.match(user, /Recent scenes \(oldest first\):\n- Two happened\.\n- Three happened\.\n- Four happened\./)
  assert.doesNotMatch(user, /One happened/)
  assert.match(user, /Most recent story text:\nP3 mid\.\nP4 near\.\nP5 newest\./)
  assert.doesNotMatch(user, /P2 older/)
})

test('a tight window keeps the newest story text and still lists every entry', () => {
  const longStory = Array.from({ length: 30 }, (_, index) => `Paragraph ${index} ${'filler '.repeat(40)}END${index}`).join('\n')
  const manyItems = Array.from({ length: 12 }, (_, index): ContextItem => ({
    id: `i${index}`, group: 'characters', label: `Person ${index}`, text: 'detail '.repeat(200),
  }))
  const input = { ...base, story: longStory, items: manyItems, numCtx: 2048, writerParagraphs: 8 }
  const request = buildContextSelectionRequest(input)
  const user = request.messages[1]?.content ?? ''
  for (let number = 1; number <= 12; number++) assert.ok(user.includes(`[${number}] Character · Person ${number - 1}`))
  assert.match(user, /\[clipped\]/)
  assert.ok(user.includes('END29'))
  assert.ok(!user.includes('END0'))
  // The whole request has to fit the selector's input window.
  const total = request.messages.reduce((sum, message) => sum + message.content.length, 0)
  assert.ok(total <= (2048 - request.outputTokens - 200) * 3.5, `request is ${total} chars`)
})

test('an impossibly small context is reported instead of silently dropping entries', () => {
  const manyItems = Array.from({ length: 200 }, (_, index): ContextItem => ({
    id: `i${index}`, group: 'setting', label: `Place ${index}`, text: 'detail',
  }))
  assert.throws(() => buildContextSelectionRequest({ ...base, items: manyItems, numCtx: 512 }), RangeError)
  assert.throws(() => buildContextSelectionRequest({ ...base, items: [] }), RangeError)
})

test('selection responses keep only valid, unique entry numbers', () => {
  assert.deepEqual(parseContextSelectionResponse('{"items":[3,1,3,9,0,-2]}', 4), [3, 1])
  assert.deepEqual(parseContextSelectionResponse('{"items":[]}', 4), [])
  assert.throws(() => parseContextSelectionResponse('not json', 4), /invalid structured/)
  assert.throws(() => parseContextSelectionResponse('{"items":["1"]}', 4), /valid items list/)
  assert.throws(() => parseContextSelectionResponse('{"entries":[1]}', 4), /valid items list/)
  assert.deepEqual(contextSelectionResponseFormat.required, ['items'])
})

test('applying a selection ticks the chosen entries and unticks the rest', () => {
  const result = applyContextSelection(items, [3, 4], ['guide'])
  assert.deepEqual(result.disabledIds.sort(), ['guide', 'syn'])
  assert.equal(result.ticked, 2)
  assert.equal(result.total, 4)
  // syn: ticked -> unticked, guide: unticked -> unticked, mara/bridge: ticked -> ticked
  assert.equal(result.changed, 1)
})

test('applying a selection can re-tick entries that were off, and leaves unrelated exclusions alone', () => {
  const result = applyContextSelection(items, [1, 2, 3, 4], ['guide', 'deleted-entry'])
  assert.deepEqual(result.disabledIds, ['deleted-entry'])
  assert.equal(result.ticked, 4)
  assert.equal(result.changed, 1)
})

test('selection numbers line up with the items the page builds from the lore fields', () => {
  const built = buildContextItems({
    synopsisSections: [{ id: 's1', title: 'Premise', text: 'A ship.' }],
    guidanceSections: [],
    characters: [{ id: 'c1', name: 'Mara', details: 'Navigator.' }],
    setting: [],
  })
  const user = buildContextSelectionRequest({ ...base, items: built }).messages[1]?.content ?? ''
  assert.match(user, /\[1\] Synopsis · Premise/)
  assert.match(user, /\[2\] Character · Mara/)
  assert.deepEqual(applyContextSelection(built, [2], []).disabledIds, ['s1'])
})
