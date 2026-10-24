<script setup lang="ts">
import { computed } from 'vue'
import { describeWordDelta, getStoryDiff } from '~/utils/storyDiff'
import type { FeedbackRevision } from '~/types/storyWriter'

const props = defineProps<{
  /** The story as it was before the last prompt or applied comment: exactly what Undo restores. */
  before: string
  after: string
  canUndo: boolean
  busy: boolean
  revisions: FeedbackRevision[]
}>()
const emit = defineEmits<{ undo: [] }>()

// Comparing while the model is still writing would redo the diff for every token.
const diff = computed(() => (props.canUndo && !props.busy ? getStoryDiff(props.before, props.after) : null))
const summary = computed(() => {
  if (!diff.value) return ''
  const { stats } = diff.value
  const parts = [describeWordDelta(stats.wordDelta)]
  if (stats.addedParagraphs) parts.push(`${stats.addedParagraphs} paragraph${stats.addedParagraphs === 1 ? '' : 's'} added`)
  if (stats.changedParagraphs) parts.push(`${stats.changedParagraphs} changed`)
  if (stats.removedParagraphs) parts.push(`${stats.removedParagraphs} removed`)
  return parts.join(' · ')
})
const history = computed(() => [...props.revisions].reverse().map((revision, index) => ({
  revision,
  number: props.revisions.length - index,
  diff: getStoryDiff(revision.before, revision.after, 1),
})))
</script>

<template>
  <div class="story-heading">
    <div>
      <p class="eyebrow">REVIEW</p>
      <h1>Changes</h1>
    </div>
    <div class="story-actions">
      <span v-if="summary" class="word-count">{{ summary }}</span>
      <button class="undo-button" type="button" :disabled="!canUndo || busy" @click="emit('undo')">Undo this change</button>
    </div>
  </div>

  <div class="story-changes">
    <p v-if="busy" class="changes-note">The model is still working. The comparison appears when it finishes.</p>
    <template v-else-if="diff">
      <p class="changes-note">
        This compares your story before the last prompt with the story now, which is exactly what <strong>Undo</strong>
        would restore. It also includes anything you typed since, and Undo would remove that too.
      </p>
      <p v-if="diff.identical" class="changes-note">No differences: the text matches the version Undo would restore.</p>
      <DiffView v-else :diff="diff" />
    </template>
    <p v-else class="changes-note">
      Nothing to compare yet. After a prompt (or an applied comment) finishes, what it changed appears here,
      and Undo will revert it.
    </p>

    <section v-if="history.length" class="changes-history">
      <h2>Applied comment changes <span>{{ history.length }}</span></h2>
      <article v-for="item in history" :key="item.revision.id" class="feedback-revision">
        <header>
          <span class="memory-number">CHANGE {{ item.number }}</span>
          <time :datetime="new Date(item.revision.appliedAt).toISOString()">{{ new Date(item.revision.appliedAt).toLocaleString() }}</time>
        </header>
        <p class="feedback-revision-instruction">{{ item.revision.instruction }}</p>
        <DiffView :diff="item.diff" />
      </article>
    </section>
  </div>
</template>
