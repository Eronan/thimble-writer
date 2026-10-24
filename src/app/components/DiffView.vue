<script setup lang="ts">
import type { StoryDiff } from '~/utils/storyDiff'

// Renders a paragraph-by-paragraph comparison. Unchanged text is shown once, rewritten
// paragraphs show Before/After with the exact edits highlighted, and long runs of unchanged
// paragraphs are folded away.
defineProps<{ diff: StoryDiff }>()
</script>

<template>
  <div class="feedback-diff story-diff">
    <template v-for="(item, index) in diff.items" :key="index">
      <div v-if="item.kind === 'gap'" class="diff-gap">
        {{ item.count }} unchanged paragraph{{ item.count === 1 ? '' : 's' }}
      </div>
      <div v-else class="feedback-diff-pair">
        <div v-if="item.type === 'context'" class="feedback-diff-line feedback-diff-context">
          <code>{{ item.pair.before }}</code>
        </div>
        <div v-else-if="item.type === 'added'" class="feedback-diff-line feedback-diff-after">
          <span>Added</span>
          <code><mark>{{ item.pair.after }}</mark></code>
        </div>
        <div v-else-if="item.type === 'removed'" class="feedback-diff-line feedback-diff-before">
          <span>Removed</span>
          <code><mark>{{ item.pair.before }}</mark></code>
        </div>
        <template v-else>
          <div class="feedback-diff-line feedback-diff-before">
            <span>Before</span>
            <code><template v-for="(run, runIndex) in item.pair.runs" :key="`before-${runIndex}`"><mark v-if="run.type === 'removed'">{{ run.value }}</mark><template v-else-if="run.type === 'equal'">{{ run.value }}</template></template></code>
          </div>
          <div class="feedback-diff-line feedback-diff-after">
            <span>After</span>
            <code><template v-for="(run, runIndex) in item.pair.runs" :key="`after-${runIndex}`"><mark v-if="run.type === 'added'">{{ run.value }}</mark><template v-else-if="run.type === 'equal'">{{ run.value }}</template></template></code>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
