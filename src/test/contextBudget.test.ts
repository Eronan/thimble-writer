import assert from 'node:assert/strict'
import test from 'node:test'
import {
  charsForContextBudget,
  allChapterStructureBudget,
  chapterSynopsisBudget,
  feedbackContextAllocation,
  loreSelectorBudget,
  proofreadingBudget,
  summarySourceBudget,
} from '../app/utils/contextBudget.ts'

test('shared context budget converts remaining tokens to a non-negative character allowance', () => {
  assert.equal(charsForContextBudget(1000, 200, 100), 2450)
  assert.equal(charsForContextBudget(100, 200, 100), 0)
})

test('summary source budget reserves output and request context', () => {
  assert.equal(summarySourceBudget(4096), Math.floor((4096 - 120 - 200) * 3.5))
  assert.equal(summarySourceBudget(100), 300)
})

test('chapter synopsis budget reserves output and context', () => {
  assert.deepEqual(chapterSynopsisBudget(4096), {
    outputTokens: 500,
    inputChars: Math.floor((4096 - 500 - 300) * 3.5),
  })

  test('full story structure reserves enough output for all chapter plans', () => {
    assert.deepEqual(allChapterStructureBudget(4096, 1), {
      outputTokens: 700,
      inputChars: Math.floor((4096 - 700 - 300) * 3.5),
    })
    assert.equal(allChapterStructureBudget(4096, 4).outputTokens, 1600)
    assert.ok(allChapterStructureBudget(4096, 4).inputChars > 0)
  })
})

test('proofreading budget applies the output floor, context reserve, and chunk cap', () => {
  assert.deepEqual(proofreadingBudget(4096, 300), {
    outputTokens: 1200,
    inputChars: Math.floor((4096 - 1200 - 300) * 3.5),
    chunkChars: 2000,
  })
  assert.equal(proofreadingBudget(1000, 100).outputTokens, 744)
})

test('lore selector and feedback context share their request allocation budgets', () => {
  assert.deepEqual(loreSelectorBudget(4096, 200, 500), {
    outputTokens: 256,
    inputChars: Math.floor((4096 - 256 - 200) * 3.5),
    loreEntriesChars: Math.floor((4096 - 256 - 200) * 3.5) - 200 - 500 - 180,
  })
  assert.deepEqual(feedbackContextAllocation(101), {
    nearbyChars: 50,
    summaryChars: 25,
    loreChars: 26,
  })
})
