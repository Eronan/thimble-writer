import assert from 'node:assert/strict'
import test from 'node:test'
import { ollamaClient, ollamaRequestOptions } from '../app/clients/ollamaClient.ts'

const settings = {
  temperature: 0.8,
  maxTokens: 300,
  numCtx: 4096,
  repeatPenalty: 1.1,
}

test('Ollama request options map settings and omit unset overrides', () => {
  assert.deepEqual(ollamaRequestOptions(settings), {
    temperature: 0.8,
    num_predict: 300,
    num_ctx: 4096,
    repeat_penalty: 1.1,
  })
  assert.deepEqual(ollamaRequestOptions(settings, {
    temperature: 0.3,
    maxTokens: 120,
    repeatPenalty: null,
  }), {
    temperature: 0.3,
    num_predict: 120,
    num_ctx: 4096,
  })
})

test('Ollama chat forwards a structured response format', async () => {
  const originalFetch = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({ message: { content: '{"comments":[]}' } }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const format = { type: 'object', properties: { comments: { type: 'array' } } }
    const response = await ollamaClient.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Proofread.' }],
      options: { temperature: 0.2, num_predict: 300, num_ctx: 4096 },
      format,
    })
    assert.equal(response, '{"comments":[]}')
    assert.deepEqual(requestBody?.format, format)
  } finally {
    globalThis.fetch = originalFetch
  }
})
