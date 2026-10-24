import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFeedbackRevisionContext } from '../app/utils/feedbackRevisionPrompt.ts'

test('feedback revision prompt stays within budget and preserves the selected passage', () => {
  const context = buildFeedbackRevisionContext({
    system: 'You are a fiction editor.',
    lore: Array.from({ length: 20 }, (_, index) => `Lore entry ${index + 1}: ${'background '.repeat(12)}`).join('\n\n'),
    summaries: ['An older summary '.repeat(30), 'The latest summary.'],
    surroundingBefore: 'Before context '.repeat(50),
    surroundingAfter: 'After context '.repeat(50),
    selectedPassage: 'The selected sentence must remain complete.',
    instruction: 'Fix the sentence.',
    maxChars: 900,
  })
  assert.ok(context.length + 'You are a fiction editor.'.length <= 900)
  assert.match(context, /The selected sentence must remain complete\./)
  assert.match(context, /Fix the sentence\./)
})

test('feedback revision context rejects a target that cannot fit', () => {
  assert.throws(() => buildFeedbackRevisionContext({
    system: 'Edit.',
    lore: '',
    summaries: [],
    surroundingBefore: '',
    surroundingAfter: '',
    selectedPassage: 'A'.repeat(100),
    instruction: 'Fix.',
    maxChars: 30,
  }), /exceed the available model context/)
})
