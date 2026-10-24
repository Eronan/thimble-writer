export type StoryFeedback = {
  id: string
  start: number
  source: string
  before: string
  after: string
  instruction: string
}

export type FeedbackRange = {
  start: number
  end: number
}

export type FeedbackDiffRun = {
  type: 'equal' | 'removed' | 'added'
  value: string
}

export type FeedbackDiffLinePair = {
  before: string | null
  after: string | null
  changed: boolean
  runs: FeedbackDiffRun[]
}

type DiffOperation<T> = {
  type: 'equal' | 'removed' | 'added'
  value: T
  afterValue?: T
}

function diffSequence<T>(before: T[], after: T[], equal: (left: T, right: T) => boolean): DiffOperation<T>[] {
  const maxDistance = before.length + after.length
  const offset = maxDistance + 1
  let frontier = new Int32Array(maxDistance * 2 + 3)
  frontier.fill(-1)
  frontier[offset + 1] = 0
  const trace: Int32Array[] = []
  let distance = 0

  search: for (; distance <= maxDistance; distance++) {
    trace.push(frontier.slice())
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const index = offset + diagonal
      let beforeIndex = diagonal === -distance
        || (diagonal !== distance && frontier[index - 1] < frontier[index + 1])
        ? frontier[index + 1]
        : frontier[index - 1] + 1
      let afterIndex = beforeIndex - diagonal
      while (
        beforeIndex < before.length
        && afterIndex < after.length
        && equal(before[beforeIndex], after[afterIndex])
      ) {
        beforeIndex++
        afterIndex++
      }
      frontier[index] = beforeIndex
      if (beforeIndex >= before.length && afterIndex >= after.length) break search
    }
  }

  const reversed: DiffOperation<T>[] = []
  let beforeIndex = before.length
  let afterIndex = after.length
  for (let step = distance; step > 0; step--) {
    const previousFrontier = trace[step]
    const diagonal = beforeIndex - afterIndex
    const previousDiagonal = diagonal === -step
      || (diagonal !== step && previousFrontier[offset + diagonal - 1] < previousFrontier[offset + diagonal + 1])
      ? diagonal + 1
      : diagonal - 1
    const previousBeforeIndex = previousFrontier[offset + previousDiagonal]
    const previousAfterIndex = previousBeforeIndex - previousDiagonal

    while (beforeIndex > previousBeforeIndex && afterIndex > previousAfterIndex) {
      reversed.push({ type: 'equal', value: before[--beforeIndex], afterValue: after[--afterIndex] })
    }
    if (beforeIndex === previousBeforeIndex) {
      reversed.push({ type: 'added', value: after[--afterIndex] })
    } else {
      reversed.push({ type: 'removed', value: before[--beforeIndex] })
    }
  }
  while (beforeIndex > 0 && afterIndex > 0) {
    reversed.push({ type: 'equal', value: before[--beforeIndex], afterValue: after[--afterIndex] })
  }
  while (beforeIndex > 0) reversed.push({ type: 'removed', value: before[--beforeIndex] })
  while (afterIndex > 0) reversed.push({ type: 'added', value: after[--afterIndex] })
  return reversed.reverse()
}

export function getFeedbackDiffLines(before: string, after: string): FeedbackDiffLinePair[] {
  const splitLines = (text: string) => text
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const beforeLines = splitLines(before)
  const afterLines = splitLines(after)
  const operations = diffSequence(beforeLines, afterLines, (left, right) => left === right)
  const result: FeedbackDiffLinePair[] = []
  let removed: string[] = []
  let added: string[] = []

  const flushChanges = () => {
    const pairCount = Math.max(removed.length, added.length)
    for (let index = 0; index < pairCount; index++) {
      const oldLine = removed[index] ?? null
      const newLine = added[index] ?? null
      const changed = oldLine !== null && newLine !== null && oldLine !== newLine
      result.push({
        before: oldLine,
        after: newLine,
        changed,
        runs: oldLine !== null && newLine !== null && changed
          ? getFeedbackDiff(oldLine, newLine)
          : [],
      })
    }
    removed = []
    added = []
  }

  for (const operation of operations) {
    if (operation.type === 'equal') {
      flushChanges()
      const oldLine = operation.value
      const newLine = operation.afterValue ?? oldLine
      result.push({ before: oldLine, after: newLine, changed: false, runs: [] })
    } else if (operation.type === 'removed') {
      removed.push(operation.value)
    } else {
      added.push(operation.value)
    }
  }
  flushChanges()
  return result
}

export function getFeedbackDiff(before: string, after: string): FeedbackDiffRun[] {
  const oldCharacters = Array.from(before)
  const newCharacters = Array.from(after)
  let prefixLength = 0
  while (prefixLength < oldCharacters.length
    && prefixLength < newCharacters.length
    && oldCharacters[prefixLength] === newCharacters[prefixLength]) {
    prefixLength++
  }

  let suffixLength = 0
  while (suffixLength < oldCharacters.length - prefixLength
    && suffixLength < newCharacters.length - prefixLength
    && oldCharacters[oldCharacters.length - suffixLength - 1] === newCharacters[newCharacters.length - suffixLength - 1]) {
    suffixLength++
  }

  const oldMiddle = oldCharacters.slice(prefixLength, oldCharacters.length - suffixLength)
  const newMiddle = newCharacters.slice(prefixLength, newCharacters.length - suffixLength)
  const maxDistance = oldMiddle.length + newMiddle.length
  const offset = maxDistance + 1
  let frontier = new Int32Array(maxDistance * 2 + 3)
  frontier.fill(-1)
  frontier[offset + 1] = 0
  const trace: Int32Array[] = []
  let distance = 0

  search: for (; distance <= maxDistance; distance++) {
    trace.push(frontier.slice())
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const index = offset + diagonal
      let oldIndex = diagonal === -distance
        || (diagonal !== distance && frontier[index - 1] < frontier[index + 1])
        ? frontier[index + 1]
        : frontier[index - 1] + 1
      let newIndex = oldIndex - diagonal
      while (
        oldIndex < oldMiddle.length
        && newIndex < newMiddle.length
        && oldMiddle[oldIndex] === newMiddle[newIndex]
      ) {
        oldIndex++
        newIndex++
      }
      frontier[index] = oldIndex
      if (oldIndex >= oldMiddle.length && newIndex >= newMiddle.length) break search
    }
  }

  const reversed: FeedbackDiffRun[] = []
  const append = (type: FeedbackDiffRun['type'], value: string) => {
    const last = reversed[reversed.length - 1]
    if (last?.type === type) last.value = value + last.value
    else reversed.push({ type, value })
  }

  let oldIndex = oldMiddle.length
  let newIndex = newMiddle.length
  for (let step = distance; step > 0; step--) {
    const previousFrontier = trace[step]
    const diagonal = oldIndex - newIndex
    const previousDiagonal = diagonal === -step
      || (diagonal !== step && previousFrontier[offset + diagonal - 1] < previousFrontier[offset + diagonal + 1])
      ? diagonal + 1
      : diagonal - 1
    const previousOldIndex = previousFrontier[offset + previousDiagonal]
    const previousNewIndex = previousOldIndex - previousDiagonal

    while (oldIndex > previousOldIndex && newIndex > previousNewIndex) {
      append('equal', oldMiddle[oldIndex - 1])
      oldIndex--
      newIndex--
    }
    if (oldIndex === previousOldIndex) {
      append('added', newMiddle[newIndex - 1])
      newIndex--
    } else {
      append('removed', oldMiddle[oldIndex - 1])
      oldIndex--
    }
  }
  while (oldIndex > 0 && newIndex > 0) {
    append('equal', oldMiddle[oldIndex - 1])
    oldIndex--
    newIndex--
  }
  while (oldIndex > 0) append('removed', oldMiddle[--oldIndex])
  while (newIndex > 0) append('added', newMiddle[--newIndex])

  const middleRuns = reversed.reverse().map(run => ({ ...run }))
  const runs: FeedbackDiffRun[] = []
  const addRun = (type: FeedbackDiffRun['type'], value: string) => {
    if (!value) return
    const last = runs[runs.length - 1]
    if (last?.type === type) last.value += value
    else runs.push({ type, value })
  }

  addRun('equal', oldCharacters.slice(0, prefixLength).join(''))
  for (const run of middleRuns) addRun(run.type, run.value)
  addRun('equal', oldCharacters.slice(oldCharacters.length - suffixLength).join(''))
  return runs
}

export function locateFeedback(text: string, comment: StoryFeedback): FeedbackRange | null {
  if (!comment.source) return null
  // Preserve the original offset when possible; surrounding anchors disambiguate repeated quotes
  // after earlier queued revisions shift text positions.
  const expectedStart = Math.max(0, Math.min(comment.start, text.length - comment.source.length))
  if (text.slice(expectedStart, expectedStart + comment.source.length) === comment.source) {
    return { start: expectedStart, end: expectedStart + comment.source.length }
  }

  const candidates: Array<FeedbackRange & { distance: number; contextMatches: number }> = []
  let start = text.indexOf(comment.source)
  while (start !== -1) {
    const end = start + comment.source.length
    const beforeMatches = Boolean(comment.before)
      && text.slice(Math.max(0, start - comment.before.length), start) === comment.before
    const afterMatches = Boolean(comment.after)
      && text.slice(end, end + comment.after.length) === comment.after
    candidates.push({
      start,
      end,
      distance: Math.abs(start - comment.start),
      contextMatches: Number(beforeMatches) + Number(afterMatches),
    })
    start = text.indexOf(comment.source, start + 1)
  }

  const best = candidates.sort((left, right) =>
    right.contextMatches - left.contextMatches || left.distance - right.distance,
  )[0]
  return best ? { start: best.start, end: best.end } : null
}
