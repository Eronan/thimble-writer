import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyEvolutionChanges,
  buildEvolutionRequest,
  evaluateEvolutionChanges,
  evolutionResponseFormat,
  evolutionSystem,
  findMentionedCharacters,
  findNormalized,
  mentionParagraphs,
  nameMatcher,
  parseEvolutionResponse,
  validateEvolutionChanges,
  type EvolutionTarget,
  type RawEvolutionChange,
} from '../app/utils/characterEvolution.ts'
import type { LoreNote } from '../app/utils/loreWorkspace.ts'

const mara: LoreNote = {
  id: 'mara', name: 'Mara Voss', characterType: 'protagonist',
  details: 'A navigator who trusts no one. She fears open water.',
  appearance: 'Short dark hair, a scar over her left eye.',
}
const tom: LoreNote = { id: 'tom', name: 'Tom', details: '', appearance: '' }

const chapter = [
  'Mara Voss gripped the rail as the ship pitched.',
  'The cook hummed in the galley.',
  'Tom laughed. "Voss, you look pale," he said.',
  '"I lost two fingers on my left hand in the storm," Mara said, flexing what remained.',
  'She decided to trust Tom with the map at last.',
].join('\n')

test('name matching finds whole words, parts of a name, and possessives, but not substrings', () => {
  const matcher = nameMatcher('Mara Voss')!
  assert.ok(matcher.test('Mara looked up.'))
  assert.ok(matcher.test('"Voss," he said.'))
  assert.ok(matcher.test("Mara's boots were wet."))
  assert.ok(matcher.test('MARA VOSS'))
  assert.ok(!matcher.test('The Maraudon tribe'))
  assert.ok(!matcher.test('Vossberg Street'))
  assert.equal(nameMatcher('   '), null)
  // Titles and articles alone never match everything
  const captain = nameMatcher('The Captain Reyes')!
  assert.ok(captain.test('Reyes nodded.'))
  assert.ok(!captain.test('The ship sailed.'))
})

test('mentioned characters are found per paragraph, with counts', () => {
  const found = findMentionedCharacters(chapter, [mara, tom, { ...tom, id: 'nobody', name: 'Zed' }])
  assert.equal(found.get('mara'), 3)
  assert.equal(found.get('tom'), 2)
  assert.equal(found.has('nobody'), false)
  assert.equal(mentionParagraphs(chapter, 'Tom').length, 2)
})

test('the request shows the entry, summaries and only the passages that mention the character', () => {
  const summaries = [{ id: 's', source: 'Mara Voss gripped the rail as the ship pitched.', summary: 'The storm hits.' }]
  const request = buildEvolutionRequest({ character: mara, chapterStory: chapter, summaries, numCtx: 4096 })!
  assert.equal(request.messages[0]?.content, evolutionSystem)
  const user = request.messages[1]?.content ?? ''
  assert.match(user, /Character entry:\nName: Mara Voss\nType: protagonist\nDetails:\nA navigator who trusts no one\./)
  assert.match(user, /Chapter summaries so far:\n- The storm hits\./)
  assert.match(user, /I lost two fingers/)
  assert.doesNotMatch(user, /cook hummed/)
  assert.equal(request.omittedPassages, 0)
  // A character the chapter never mentions needs no request at all
  assert.equal(buildEvolutionRequest({ character: { ...tom, name: 'Zed' }, chapterStory: chapter, summaries: [], numCtx: 4096 }), null)
})

test('when passages do not fit, the newest are kept and the omission is reported', () => {
  const long = Array.from({ length: 40 }, (_, index) => `Mara Voss did thing ${index}. ${'filler '.repeat(40)}END${index}`).join('\n')
  const request = buildEvolutionRequest({ character: mara, chapterStory: long, summaries: [], numCtx: 2048 })!
  const user = request.messages[1]?.content ?? ''
  assert.ok(user.includes('END39'))
  assert.ok(!user.includes('END0 '))
  assert.ok(request.omittedPassages > 0)
  assert.equal(request.passageCount + request.omittedPassages, 40)
  const total = request.messages.reduce((sum, message) => sum + message.content.length, 0)
  assert.ok(total <= (2048 - request.outputTokens - 250) * 3.5)
})

test('an entry too large for the context is reported', () => {
  const huge = { ...mara, details: 'x'.repeat(20000) }
  assert.throws(() => buildEvolutionRequest({ character: huge, chapterStory: chapter, summaries: [], numCtx: 2048 }), RangeError)
})

test('responses parse, and malformed items are skipped rather than trusted', () => {
  const good = { field: 'details', op: 'add', old: '', new: 'Lost two fingers.', reason: 'Storm injury', evidence: 'I lost two fingers' }
  const parsed = parseEvolutionResponse(JSON.stringify({ changes: [good, { ...good, field: 'type' }, { ...good, op: 'rewrite' }, { ...good, reason: '' }, 'junk'] }))
  assert.equal(parsed.changes.length, 1)
  assert.equal(parsed.skipped, 4)
  assert.throws(() => parseEvolutionResponse('nope'), /invalid structured/)
  assert.throws(() => parseEvolutionResponse('{"items":[]}'), /without a changes list/)
  assert.deepEqual(evolutionResponseFormat.required, ['changes'])
})

const raw = (overrides: Partial<RawEvolutionChange>): RawEvolutionChange => ({
  field: 'details', op: 'add', old: '', new: 'Lost two fingers on her left hand.', reason: 'Storm injury',
  evidence: 'I lost two fingers on my left hand in the storm', ...overrides,
})

test('evidence must really be in the chapter, and the chapter\'s own wording is shown', () => {
  const fields = { details: mara.details, appearance: mara.appearance ?? '' }
  const ok = validateEvolutionChanges(fields, chapter, [raw({ evidence: 'i LOST two fingers on my left HAND in the storm' })])
  assert.equal(ok.changes.length, 1)
  assert.equal(ok.changes[0]?.evidence, 'I lost two fingers on my left hand in the storm')
  const invented = validateEvolutionChanges(fields, chapter, [raw({ evidence: 'She lost her left leg to a shark attack' })])
  assert.equal(invented.changes.length, 0)
  assert.equal(invented.skipped.evidence, 1)
  const tooShort = validateEvolutionChanges(fields, chapter, [raw({ evidence: 'storm' })])
  assert.equal(tooShort.skipped.evidence, 1)
  // curly quotes and line breaks in the model's copy do not matter
  const loose = validateEvolutionChanges(fields, chapter, [raw({ evidence: '“I lost two fingers\non my left hand' })])
  assert.equal(loose.changes.length, 1)
})

test('replace and remove need old text that appears in the entry exactly once', () => {
  const fields = { details: 'She is calm. She is calm. She fears open water.', appearance: '' }
  const result = validateEvolutionChanges(fields, chapter, [
    raw({ op: 'replace', old: 'She fears open water.', new: 'She no longer fears open water.', evidence: 'She decided to trust Tom with the map' }),
    raw({ op: 'replace', old: 'She is calm.', new: 'She is edgy.', evidence: 'She decided to trust Tom with the map' }),
    raw({ op: 'remove', old: 'She never said that.', new: '', evidence: 'She decided to trust Tom with the map' }),
  ])
  assert.deepEqual(result.changes.map(change => change.old), ['She fears open water.'])
  assert.equal(result.skipped.unmatched, 2)
})

test('additions already present, overlong text, repeats and extras beyond the limit are dropped', () => {
  const fields = { details: 'A navigator. Lost two fingers on her left hand.', appearance: '' }
  const dup = validateEvolutionChanges(fields, chapter, [raw({ new: 'lost two fingers on her left hand.' })])
  assert.equal(dup.skipped.duplicate, 1)
  const long = validateEvolutionChanges(fields, chapter, [raw({ new: 'x'.repeat(401) })])
  assert.equal(long.skipped.size, 1)
  const many = validateEvolutionChanges({ details: '', appearance: '' }, chapter,
    Array.from({ length: 8 }, (_, index) => raw({ new: `Distinct fact number ${index}.` })))
  assert.equal(many.changes.length, 5)
  assert.equal(many.skipped.limit, 3)
  const twice = validateEvolutionChanges({ details: '', appearance: '' }, chapter, [raw({}), raw({})])
  assert.equal(twice.changes.length, 1)
})

test('findNormalized maps back to the original text', () => {
  const text = 'Before.\n\n“Hello   there,” she said.'
  const found = findNormalized(text, '"hello there," she said')!
  assert.equal(text.slice(found.start, found.end), '“Hello   there,” she said')
})

const target = (overrides: Partial<EvolutionTarget> & { id: string }): EvolutionTarget => ({
  field: 'details', op: 'add', old: '', new: '', ...overrides,
})

test('applying adds, replaces and removes only the chosen text', () => {
  const fields = { details: 'A navigator. She fears open water. She is calm.', appearance: 'Short dark hair.' }
  const result = applyEvolutionChanges(fields, [
    target({ id: 'a', op: 'replace', old: 'She fears open water.', new: 'She now sails fearlessly.' }),
    target({ id: 'b', op: 'remove', old: ' She is calm.' }),
    target({ id: 'c', op: 'add', new: 'Lost two fingers.' }),
    target({ id: 'd', field: 'appearance', op: 'add', new: 'Missing two fingers.' }),
  ])
  assert.equal(result.details, 'A navigator. She now sails fearlessly. Lost two fingers.')
  assert.equal(result.appearance, 'Short dark hair. Missing two fingers.')
  assert.deepEqual([...result.applied].sort(), ['a', 'b', 'c', 'd'])
  assert.deepEqual(result.failed, [])
})

test('additions join prose on the same line and notes on a new line', () => {
  assert.equal(applyEvolutionChanges({ details: 'Prose.', appearance: '' }, [target({ id: 'a', new: 'More.' })]).details, 'Prose. More.')
  assert.equal(applyEvolutionChanges({ details: '- one\n- two', appearance: '' }, [target({ id: 'a', new: '- three' })]).details, '- one\n- two\n- three')
  assert.equal(applyEvolutionChanges({ details: '', appearance: '' }, [target({ id: 'a', new: 'First.' })]).details, 'First.')
})

test('changes that no longer fit the entry are reported, not forced', () => {
  const fields = { details: 'Edited since the proposal.', appearance: '' }
  const result = applyEvolutionChanges(fields, [
    target({ id: 'gone', op: 'replace', old: 'She fears open water.', new: 'x' }),
    target({ id: 'dup', op: 'add', new: 'edited since the proposal.' }),
  ])
  assert.equal(result.details, 'Edited since the proposal.')
  assert.deepEqual(result.failed.map(item => [item.id, item.reason]), [['gone', 'stale'], ['dup', 'duplicate']])
})

test('overlapping selected edits conflict and only the earlier one applies', () => {
  const fields = { details: 'She fears open water and storms.', appearance: '' }
  const changes = [
    target({ id: 'wide', op: 'replace', old: 'fears open water and storms', new: 'is brave' }),
    target({ id: 'narrow', op: 'replace', old: 'open water', new: 'the sea' }),
  ]
  const states = evaluateEvolutionChanges(fields, changes.map(change => ({ ...change, selected: true })))
  assert.equal(states.get('wide'), 'ready')
  assert.equal(states.get('narrow'), 'conflict')
  const result = applyEvolutionChanges(fields, changes)
  assert.equal(result.details, 'She is brave.')
  assert.deepEqual(result.failed.map(item => item.id), ['narrow'])
  // Unselected changes never conflict, so the writer can resolve it by unticking one
  const oneSelected = evaluateEvolutionChanges(fields, [
    { ...changes[0]!, selected: true }, { ...changes[1]!, selected: false },
  ])
  assert.equal(oneSelected.get('narrow'), 'ready')
})
