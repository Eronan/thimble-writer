import assert from 'node:assert/strict'
import test from 'node:test'
import { ollamaRequestOptions } from '../app/clients/ollamaClient.ts'

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
