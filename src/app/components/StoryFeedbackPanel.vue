<script setup lang="ts">
import { computed, ref } from 'vue'
import { getFeedbackDiffLines, locateFeedback, type StoryFeedback } from '~/utils/storyFeedback'
import type { FeedbackRevision } from '~/composables/useStoryWriter'

const props = defineProps<{
  story: string
  revisions: FeedbackRevision[]
  selection: { start: number; end: number; text: string } | null
  busy: boolean
  modelAvailable: boolean
  activeFeedbackId: string | null
  proofreading: boolean
}>()

const feedback = defineModel<StoryFeedback[]>({ required: true })
const emit = defineEmits<{
  add: [selection: { start: number; end: number; text: string }, instruction: string]
  apply: [id?: string]
  proofread: []
  remove: [id: string]
  hover: [id: string | null]
}>()

const instruction = ref<HTMLTextAreaElement | null>(null)
const instructionText = ref('')
const validSelection = computed(() => {
  const selection = props.selection
  return selection
    && selection.start >= 0
    && selection.end > selection.start
    && selection.end <= props.story.length
    && props.story.slice(selection.start, selection.end) === selection.text
    ? selection
    : null
})

function excerpt(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 115 ? `${normalized.slice(0, 115)}…` : normalized
}

function addComment() {
  if (!validSelection.value || !instructionText.value.trim()) return
  emit('add', validSelection.value, instructionText.value)
  instructionText.value = ''
}

function focusInstruction() {
  instruction.value?.focus()
}

defineExpose({ focusInstruction })
</script>

<template>
  <section class="feedback-panel">
    <header class="feedback-heading">
      <div>
        <p class="eyebrow">TARGETED EDITING</p>
        <h1>Feedback</h1>
      </div>
      <span class="count-pill">{{ feedback.length }} queued</span>
    </header>
    <p class="feedback-help">Proofreading adds reviewable comments without changing your story. You can also select text and add your own passage-specific instructions.</p>

    <button
      class="proofread-button"
      type="button"
      :disabled="busy || !modelAvailable || !story.trim()"
      @click="emit('proofread')"
    >
      {{ proofreading ? 'Proofreading…' : 'Proofread story' }}
    </button>

    <button
      class="apply-feedback-button"
      type="button"
      :disabled="busy || !modelAvailable || !feedback.length || feedback.some(comment => !comment.instruction.trim() || !locateFeedback(story, comment))"
      @click="emit('apply')"
    >
      {{ busy ? 'Revising passages…' : `Apply all ${feedback.length} comment${feedback.length === 1 ? '' : 's'}` }}
    </button>

    <div class="feedback-composer">
      <p class="feedback-selection">
        {{ validSelection ? `Selected: “${excerpt(validSelection.text)}”` : 'Select text in the story to attach feedback.' }}
      </p>
      <textarea
        ref="instruction"
        v-model="instructionText"
        aria-label="Feedback for selected story passage"
        placeholder="What should change in this passage?"
        rows="3"
      />
      <button class="add-feedback-button" type="button" :disabled="!validSelection || !instructionText.trim()" @click="addComment">
        Add comment
      </button>
    </div>

    <div class="feedback-activity">
      <div v-if="feedback.length" class="feedback-list">
        <article
          v-for="(comment, index) in feedback"
          :key="comment.id"
          class="feedback-card"
          :class="{ 'feedback-card-active': activeFeedbackId === comment.id }"
          @mouseenter="emit('hover', comment.id)"
          @mouseleave="emit('hover', null)"
          @focusin="emit('hover', comment.id)"
          @focusout="emit('hover', null)"
        >
          <header>
            <span class="memory-number">COMMENT {{ index + 1 }}</span>
            <span v-if="!locateFeedback(story, comment)" class="memory-stale">Passage unavailable</span>
            <button
              class="memory-remove"
              type="button"
              :aria-label="`Remove feedback ${index + 1}`"
              @click="emit('remove', comment.id)"
            >×</button>
          </header>
          <p class="feedback-excerpt">{{ excerpt(comment.source) }}</p>
          <textarea v-model="comment.instruction" :aria-label="`Instruction for comment ${index + 1}`" rows="2" />
          <button
            class="apply-single-feedback-button"
            type="button"
            :disabled="busy || !modelAvailable || !comment.instruction.trim() || !locateFeedback(story, comment)"
            @click="emit('apply', comment.id)"
          >Apply this comment</button>
        </article>
      </div>
      <p v-if="!feedback.length && !revisions.length" class="feedback-empty">Your passage-specific comments will appear here.</p>

      <details v-if="revisions.length" class="feedback-revision-history">
        <summary>Applied changes <span>{{ revisions.length }}</span></summary>
        <article v-for="(revision, index) in [...revisions].reverse()" :key="revision.id" class="feedback-revision">
          <header>
            <span class="memory-number">CHANGE {{ revisions.length - index }}</span>
            <time :datetime="new Date(revision.appliedAt).toISOString()">{{ new Date(revision.appliedAt).toLocaleString() }}</time>
          </header>
          <p class="feedback-revision-instruction">{{ revision.instruction }}</p>
          <div class="feedback-diff">
            <!-- Show unchanged prose once to reduce noise; pair only real edits and highlight their
                 individual characters so the user can judge exactly what feedback changed. -->
            <div v-for="(line, lineIndex) in getFeedbackDiffLines(revision.before, revision.after)" :key="lineIndex" class="feedback-diff-pair">
              <div v-if="!line.changed" class="feedback-diff-line feedback-diff-context">
                <code>{{ line.before }}</code>
              </div>
              <template v-else>
              <div class="feedback-diff-line feedback-diff-before">
                <span>Before</span>
                <code><template v-for="(run, runIndex) in line.runs" :key="`before-${runIndex}`"><mark v-if="run.type === 'removed'">{{ run.value }}</mark><template v-else-if="run.type === 'equal'">{{ run.value }}</template></template></code>
              </div>
              <div class="feedback-diff-line feedback-diff-after">
                <span>After</span>
                <code><template v-for="(run, runIndex) in line.runs" :key="`after-${runIndex}`"><mark v-if="run.type === 'added'">{{ run.value }}</mark><template v-else-if="run.type === 'equal'">{{ run.value }}</template></template></code>
              </div>
              </template>
            </div>
          </div>
        </article>
      </details>
    </div>
  </section>
</template>
