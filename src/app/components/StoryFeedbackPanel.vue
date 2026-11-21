<script setup lang="ts">
import { computed, ref } from 'vue'
import { locateFeedback, type StoryFeedback } from '~/utils/storyFeedback'
import { splitFeedback } from '~/utils/storyFixes'
import type { FeedbackRevision } from '~/types/storyWriter'

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
  acceptFix: [id: string]
  acceptAllFixes: []
  proofread: []
  remove: [id: string]
  hover: [id: string | null]
  showChanges: []
}>()

const instruction = ref<HTMLTextAreaElement | null>(null)
const instructionText = ref('')
const fixes = computed(() => splitFeedback(feedback.value).fixes)
const comments = computed(() => splitFeedback(feedback.value).comments)
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
const acceptableFixCount = computed(() =>
  fixes.value.filter(fix => fix.replacement.trim() && locateFeedback(props.story, fix)).length,
)

function excerpt(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 115 ? `${normalized.slice(0, 115)}…` : normalized
}

function addComment() {
  if (!validSelection.value || !instructionText.value.trim()) return
  emit('add', validSelection.value, instructionText.value)
  instructionText.value = ''
}

// Fixes and comments share one list in the draft, so each clear action keeps the other kind.
// Neither changes the story text.
function clearFixes() {
  const count = fixes.value.length
  if (!count || props.busy) return
  if (!window.confirm(`Dismiss all ${count} suggested fix${count === 1 ? '' : 'es'}? Your story text is not changed.`)) return
  feedback.value = comments.value
  emit('hover', null)
}

function clearComments() {
  const count = comments.value.length
  if (!count || props.busy) return
  if (!window.confirm(`Clear all ${count} comment${count === 1 ? '' : 's'}? Suggested fixes are kept and your story text is not changed.`)) return
  feedback.value = fixes.value
  emit('hover', null)
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
    <p class="feedback-help">Proofreading suggests exact fixes you can accept with one click; only the quoted text changes. Your own comments describe a change in words, and the model rewrites that passage.</p>

    <button
      class="proofread-button"
      type="button"
      :disabled="busy || !modelAvailable || !story.trim()"
      @click="emit('proofread')"
    >
      {{ proofreading ? 'Proofreading…' : 'Proofread story' }}
    </button>

    <div class="feedback-activity">
      <section class="feedback-section" aria-labelledby="fixes-heading">
        <header class="feedback-section-heading">
          <h2 id="fixes-heading">Suggested fixes</h2>
          <span class="count-pill">{{ fixes.length }}</span>
        </header>
        <p v-if="!fixes.length" class="feedback-empty">Proofread the story to get exact before-and-after fixes.</p>
        <template v-else>
          <div class="feedback-section-actions">
            <button
              class="apply-feedback-button"
              type="button"
              :disabled="busy || !acceptableFixCount"
              @click="emit('acceptAllFixes')"
            >
              Accept {{ acceptableFixCount === fixes.length ? 'all' : '' }} {{ acceptableFixCount }} fix{{ acceptableFixCount === 1 ? '' : 'es' }}
            </button>
            <button class="clear-feedback-button" type="button" :disabled="busy" @click="clearFixes">
              Clear fixes
            </button>
          </div>
          <div class="feedback-list">
            <article
              v-for="(fix, index) in fixes"
              :key="fix.id"
              class="feedback-card fix-card"
              :class="{ 'feedback-card-active': activeFeedbackId === fix.id }"
              @mouseenter="emit('hover', fix.id)"
              @mouseleave="emit('hover', null)"
              @focusin="emit('hover', fix.id)"
              @focusout="emit('hover', null)"
            >
              <header>
                <span class="memory-number">FIX {{ index + 1 }}</span>
                <span v-if="!locateFeedback(story, fix)" class="memory-stale">Passage unavailable</span>
                <button
                  class="memory-remove"
                  type="button"
                  :aria-label="`Dismiss fix ${index + 1}`"
                  :disabled="busy"
                  @click="emit('remove', fix.id)"
                >×</button>
              </header>
              <p class="fix-issue">{{ fix.instruction }}</p>
              <p class="fix-diff fix-removed"><span class="fix-sign" aria-hidden="true">−</span><span class="sr-only">Replace </span>{{ fix.source }}</p>
              <label class="fix-diff fix-added">
                <span class="fix-sign" aria-hidden="true">+</span>
                <span class="sr-only">With</span>
                <textarea
                  v-model="fix.replacement"
                  :aria-label="`Replacement text for fix ${index + 1}`"
                  rows="2"
                  :disabled="busy"
                />
              </label>
              <button
                class="apply-single-feedback-button"
                type="button"
                :disabled="busy || !fix.replacement.trim() || !locateFeedback(story, fix)"
                @click="emit('acceptFix', fix.id)"
              >Accept this fix</button>
            </article>
          </div>
        </template>
      </section>

      <section class="feedback-section" aria-labelledby="comments-heading">
        <header class="feedback-section-heading">
          <h2 id="comments-heading">Comments &amp; criticism</h2>
          <span class="count-pill">{{ comments.length }}</span>
        </header>

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
            :disabled="busy"
          />
          <button class="add-feedback-button" type="button" :disabled="busy || !validSelection || !instructionText.trim()" @click="addComment">
            Add comment
          </button>
        </div>

        <template v-if="comments.length">
          <div class="feedback-section-actions">
            <button
              class="apply-feedback-button"
              type="button"
              :disabled="busy || !modelAvailable || comments.some(comment => !comment.instruction.trim() || !locateFeedback(story, comment))"
              @click="emit('apply')"
            >
              {{ busy ? 'Revising passages…' : `Apply all ${comments.length} comment${comments.length === 1 ? '' : 's'}` }}
            </button>
            <button class="clear-feedback-button" type="button" :disabled="busy" @click="clearComments">
              Clear comments
            </button>
          </div>
          <div class="feedback-list">
            <article
              v-for="(comment, index) in comments"
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
                  :disabled="busy"
                  @click="emit('remove', comment.id)"
                >×</button>
              </header>
              <p class="feedback-excerpt">{{ excerpt(comment.source) }}</p>
              <textarea v-model="comment.instruction" :aria-label="`Instruction for comment ${index + 1}`" rows="2" :disabled="busy" />
              <button
                class="apply-single-feedback-button"
                type="button"
                :disabled="busy || !modelAvailable || !comment.instruction.trim() || !locateFeedback(story, comment)"
                @click="emit('apply', comment.id)"
              >Apply this comment</button>
            </article>
          </div>
        </template>
        <p v-else class="feedback-empty">Your passage-specific comments will appear here.</p>
      </section>

      <p v-if="revisions.length" class="feedback-applied-note">
        {{ revisions.length }} applied change{{ revisions.length === 1 ? '' : 's' }}.
        <button type="button" class="undo-button" @click="emit('showChanges')">View in Changes</button>
      </p>
    </div>
  </section>
</template>
