import assert from 'node:assert/strict'
import test from 'node:test'
import { ollamaClient } from '../app/clients/ollamaClient.ts'
import { clearDebugEntries, debugEntries, diagnoseEntry, startDebugEntry, type DebugEntry } from '../app/clients/debugLog.ts'

const options = { temperature: 0.2, num_predict: 100, num_ctx: 2048 }
const messages = [{ role: 'user' as const, content: 'hello' }]

async function withFetch(handler: () => Response, run: () => Promise<void>) {
  const original = globalThis.fetch
  globalThis.fetch = async () => handler()
  try {
    await run()
  } finally {
    globalThis.fetch = original
  }
}

const jsonReply = (content: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ message: { content }, done: true, ...extra }), { headers: { 'Content-Type': 'application/json' } })

test('a successful chat is logged with its raw response and token counts', async () => {
  clearDebugEntries()
  await withFetch(() => jsonReply('hi there', { done_reason: 'stop', prompt_eval_count: 12, eval_count: 3 }), async () => {
    const text = await ollamaClient.chat({ model: 'm', messages, options, label: 'test call' })
    assert.equal(text, 'hi there')
  })
  assert.equal(debugEntries.length, 1)
  const entry = debugEntries[0]!
  assert.equal(entry.label, 'test call')
  assert.equal(entry.status, 'ok')
  assert.equal(entry.response, 'hi there')
  assert.deepEqual(entry.meta, { doneReason: 'stop', promptTokens: 12, replyTokens: 3 })
  assert.equal(typeof entry.durationMs, 'number')
})

test('a parser failure is logged against the request that produced the text', async () => {
  clearDebugEntries()
  await withFetch(() => jsonReply('{"comments": [oops'), async () => {
    await assert.rejects(
      ollamaClient.chat({
        model: 'm', messages, options, format: { type: 'object' }, label: 'Proofread',
        parse: (text) => JSON.parse(text),
      }),
      SyntaxError,
    )
  })
  const entry = debugEntries[0]!
  assert.equal(entry.status, 'parse-failed')
  assert.equal(entry.response, '{"comments": [oops')
  assert.match(entry.error, /JSON|Expected|position/)
})

test('a parse function result is returned to the caller', async () => {
  clearDebugEntries()
  await withFetch(() => jsonReply('[1,2,3]'), async () => {
    const numbers = await ollamaClient.chat({ model: 'm', messages, options, parse: (text) => JSON.parse(text) as number[] })
    assert.deepEqual(numbers, [1, 2, 3])
  })
  assert.equal(debugEntries[0]!.status, 'ok')
})

test('HTTP errors are logged as errors', async () => {
  clearDebugEntries()
  await withFetch(() => new Response('model not found', { status: 404 }), async () => {
    await assert.rejects(ollamaClient.chat({ model: 'missing', messages, options }), /404/)
  })
  assert.equal(debugEntries[0]!.status, 'error')
  assert.match(debugEntries[0]!.error, /model not found/)
})

test('streamed responses accumulate and record the final token counts', async () => {
  clearDebugEntries()
  const lines = [
    { message: { content: 'Once ' }, done: false },
    { message: { content: 'upon' }, done: false },
    { message: { content: '' }, done: true, done_reason: 'length', prompt_eval_count: 40, eval_count: 9 },
  ].map(item => JSON.stringify(item)).join('\n')
  await withFetch(() => new Response(lines), async () => {
    let received = ''
    await ollamaClient.streamChat({ model: 'm', messages, options, label: 'Write next' }, (text) => { received += text })
    assert.equal(received, 'Once upon')
  })
  const entry = debugEntries[0]!
  assert.equal(entry.streamed, true)
  assert.equal(entry.response, 'Once upon')
  assert.equal(entry.status, 'ok')
  assert.equal(entry.meta.doneReason, 'length')
  assert.equal(entry.meta.promptTokens, 40)
})

test('the log keeps only the most recent entries', () => {
  clearDebugEntries()
  for (let i = 0; i < 100; i++) startDebugEntry({ label: `call ${i}`, endpoint: '/api/chat', model: 'm', streamed: false, request: { options } })
  assert.equal(debugEntries.length, 80)
  assert.equal(debugEntries[0]!.label, 'call 99')
})

function entryWith(patch: Partial<DebugEntry>): DebugEntry {
  return {
    id: 1, label: 'x', endpoint: '/api/chat', model: 'm', streamed: false, startedAt: 0, durationMs: 5,
    status: 'parse-failed', request: { options }, response: '', error: '', meta: {}, ...patch,
  }
}

test('diagnosis explains a reply that was cut off by the token limit', () => {
  const hints = diagnoseEntry(entryWith({
    request: { options, format: { type: 'object' } },
    response: '{"comments":[{"quote":"teh"',
    meta: { doneReason: 'length' },
  }))
  assert.ok(hints.some(hint => /token limit/.test(hint)))
  assert.ok(hints.some(hint => /invalid and appears to end early/.test(hint)))
})

test('diagnosis spots code fences, prose instead of JSON, and empty replies', () => {
  const format = { type: 'object' }
  assert.ok(diagnoseEntry(entryWith({ request: { options, format }, response: '```json\n{"a":1}\n```' })).some(h => /code fence/.test(h)))
  assert.ok(diagnoseEntry(entryWith({ request: { options, format }, response: 'Sure! Here are the comments.' })).some(h => /not JSON at all/.test(h)))
  assert.ok(diagnoseEntry(entryWith({ response: '   ' })).some(h => /empty/.test(h)))
})

test('diagnosis flags valid JSON of the wrong shape and a full context window', () => {
  const hints = diagnoseEntry(entryWith({
    request: { options, format: { type: 'object' } },
    response: '{"unexpected": true}',
    meta: { promptTokens: 2045 },
  }))
  assert.ok(hints.some(hint => /valid, but its shape/.test(hint)))
  assert.ok(hints.some(hint => /2045 of 2048/.test(hint)))
})
