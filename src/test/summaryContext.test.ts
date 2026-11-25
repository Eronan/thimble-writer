import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSummaryPickRequest,
  formatSummaryReference,
  parseSummaryPickResponse,
  summaryPickCandidates,
  summaryPickResponseFormat,
  summaryPickSystem,
} from '../app/utils/summaryContext.ts'
import type { ContextItem } from '../app/utils/loreWorkspace.ts'

const items: ContextItem[] = [
  { id: 'syn', group: 'synopsis', label: 'Premise', text: 'A ship is lost in a nebula.' },
  { id: 'guide', group: 'guidance', label: 'Voice', text: 'Terse, present tense.' },
  { id: 'mara', group: 'characters', label: 'Mara', text: 'Mara\nNavigator. Female, uses she/her. Distrusts the captain.' },
  { id: 'reyes', group: 'characters', label: 'Captain Reyes', text: 'The old captain. Male, gruff.' },
  { id: 'bridge', group: 'setting', label: 'The bridge', text: 'Cramped, lit red.' },
]

test('writing guidance is never offered to the summarizer', () => {
  assert.deepEqual(summaryPickCandidates(items).map(item => item.id), ['syn', 'mara', 'reyes', 'bridge'])
})

test('the pick request separates earlier summaries, the section, and the numbered entries', () => {
  const candidates = summaryPickCandidates(items)
  const { messages } = buildSummaryPickRequest({
    items: candidates,
    sectionText: 'She pushed the door open. The old man did not look up.',
    background: ['- The crew reached the harbour.', '- Mara argued with the captain.'],
    chapterSynopsis: 'A mutiny brews.',
    numCtx: 4096,
  })
  assert.equal(messages[0]?.content, summaryPickSystem)
  const user = messages[1]?.content ?? ''
  const listAt = user.indexOf('Numbered setup entries:')
  const sectionAt = user.indexOf('Section to summarize:')
  assert.ok(sectionAt >= 0 && listAt > sectionAt)
  assert.match(user.slice(0, sectionAt), /Summaries of earlier sections \(oldest first\):\n- The crew reached the harbour\.\n- Mara argued/)
  assert.match(user.slice(0, sectionAt), /Chapter synopsis:\nA mutiny brews\./)
  assert.match(user.slice(sectionAt, listAt), /"""\nShe pushed the door open\./)
  const list = user.slice(listAt)
  assert.match(list, /\[1\] Synopsis · Premise/)
  assert.match(list, /\[2\] Character · Mara: Navigator\./)
  assert.match(list, /\[3\] Character · Captain Reyes/)
  assert.match(list, /\[4\] Setting · The bridge/)
  assert.doesNotMatch(list, /Voice/)
  // the section and summaries never leak into the entry list
  assert.doesNotMatch(list, /pushed the door|harbour/)
})

test('a request that cannot fit every entry beside the section is reported so the caller can fall back', () => {
  const many = Array.from({ length: 150 }, (_, index): ContextItem => ({
    id: `c${index}`, group: 'characters', label: `Person ${index}`, text: 'detail',
  }))
  assert.throws(() => buildSummaryPickRequest({
    items: many, sectionText: 'x'.repeat(1500), background: [], chapterSynopsis: '', numCtx: 512,
  }), RangeError)
  assert.throws(() => buildSummaryPickRequest({
    items: [], sectionText: 'x', background: [], chapterSynopsis: '', numCtx: 4096,
  }), RangeError)
})

test('the whole pick request fits the selector window', () => {
  const request = buildSummaryPickRequest({
    items: summaryPickCandidates(items),
    sectionText: 'Paragraph. '.repeat(200),
    background: Array.from({ length: 30 }, (_, index) => `- Earlier event ${index} ${'detail '.repeat(10)}`),
    chapterSynopsis: 'Long synopsis. '.repeat(100),
    numCtx: 2048,
  })
  const total = request.messages.reduce((sum, message) => sum + message.content.length, 0)
  assert.ok(total <= (2048 - request.outputTokens - 200) * 3.5, `request is ${total} chars`)
  // The nearest earlier summaries are the ones kept when background is trimmed.
  const user = request.messages[1]?.content ?? ''
  assert.ok(user.includes('Earlier event 29'))
  assert.ok(!user.includes('Earlier event 0 '))
})

test('pick responses reuse the shared items contract', () => {
  assert.deepEqual(summaryPickResponseFormat.required, ['items'])
  assert.deepEqual(parseSummaryPickResponse('{"items":[2,3,2,99]}', 4), [2, 3])
  assert.deepEqual(parseSummaryPickResponse('{"items":[]}', 4), [])
  assert.throws(() => parseSummaryPickResponse('garbage', 4), /invalid structured/)
})

test('the reference block has the chapter synopsis, then each picked entry with its details', () => {
  const lines = formatSummaryReference({
    entries: [items[2]!, items[3]!],
    chapterSynopsis: 'A mutiny brews on the ship.',
    maxChars: 2000,
  })
  assert.deepEqual(lines, [
    'Chapter synopsis: A mutiny brews on the ship.',
    '- Character · Mara: Navigator. Female, uses she/her. Distrusts the captain.',
    '- Character · Captain Reyes: The old captain. Male, gruff.',
  ])
})

test('reference entries are clipped evenly, and later ones dropped when each cannot keep useful text', () => {
  const long = Array.from({ length: 6 }, (_, index): ContextItem => ({
    id: `c${index}`, group: 'characters', label: `Person ${index}`, text: `detail${index} `.repeat(80),
  }))
  const clipped = formatSummaryReference({ entries: long, chapterSynopsis: '', maxChars: 900 })
  assert.ok(clipped.length > 0 && clipped.length <= 6)
  assert.ok(clipped.join('\n').length <= 900)
  assert.ok(clipped.every(line => line.endsWith('…')))
  assert.ok(clipped[0]!.includes('Person 0'))
  const tiny = formatSummaryReference({ entries: long, chapterSynopsis: '', maxChars: 150 })
  assert.ok(tiny.length < clipped.length)
  assert.deepEqual(formatSummaryReference({ entries: [], chapterSynopsis: '', maxChars: 500 }), [])
})

test('a character entry\'s own name is not repeated after its label', () => {
  const lines = formatSummaryReference({ entries: [items[2]!], chapterSynopsis: '', maxChars: 500 })
  assert.deepEqual(lines, ['- Character · Mara: Navigator. Female, uses she/her. Distrusts the captain.'])
  // a name that merely starts the details of a different word is left alone
  const tricky: ContextItem = { id: 't', group: 'characters', label: 'Tom', text: 'Tomas is his brother.' }
  assert.deepEqual(formatSummaryReference({ entries: [tricky], chapterSynopsis: '', maxChars: 500 }), ['- Character · Tom: Tomas is his brother.'])
})
