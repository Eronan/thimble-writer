<script setup lang="ts">
const {
  draft,
  models,
  loadingModels,
  generating,
  summarizing,
  revisingFeedback,
  error,
  status,
  canUndo,
  selectedModelSize,
  refreshModels,
  summarizeOlderSections,
  removeSummary,
  addFeedback,
  applyFeedback,
  removeFeedback,
  writeNext,
  undo,
} = useStoryWriter()

const settingsOpen = ref(false)
const activeSummaryId = ref<string | null>(null)
const activeFeedbackId = ref<string | null>(null)
const storySelection = ref<{ start: number; end: number; text: string } | null>(null)
const feedbackPanel = ref<{ focusInstruction: () => void } | null>(null)

function queueFeedback(selection: { start: number; end: number; text: string }, instruction: string) {
  if (addFeedback(selection, instruction)) storySelection.value = null
}

function focusFeedbackComposer() {
  feedbackPanel.value?.focusInstruction()
}
</script>

<template>
  <main class="writer">
    <WriterHeader
      v-model:draft="draft"
      v-model:settings-open="settingsOpen"
      :models="models"
      :loading-models="loadingModels"
      :selected-model-size="selectedModelSize"
      @refresh="refreshModels"
    />

    <div class="workspace">
      <LorePanel v-model="draft.lore" />
      <section class="story-panel">
        <StoryEditor
          v-model="draft.story"
          :can-undo="canUndo"
          :generating="generating"
          :summaries="draft.summaries"
          :active-summary-id="activeSummaryId"
          :feedback="draft.feedback"
          :active-feedback-id="activeFeedbackId"
          @undo="undo"
          @comment="focusFeedbackComposer"
          @selection="storySelection = $event"
        />
        <PromptComposer
          v-model="draft.prompt"
          :error="error"
          :status="status"
          :generating="generating"
          :model-available="Boolean(draft.model)"
          @write="writeNext"
        />
      </section>
      <aside class="right-panels">
        <StoryMemory
          v-model="draft.summaries"
          :story="draft.story"
          :busy="summarizing || generating || revisingFeedback"
          :model-available="Boolean(draft.model)"
          :active-summary-id="activeSummaryId"
          @summarize="summarizeOlderSections()"
          @remove="removeSummary"
          @hover="activeSummaryId = $event"
        />
        <StoryFeedbackPanel
          ref="feedbackPanel"
          v-model="draft.feedback"
          :story="draft.story"
          :revisions="draft.feedbackRevisions"
          :selection="storySelection"
          :busy="summarizing || generating || revisingFeedback"
          :model-available="Boolean(draft.model)"
          :active-feedback-id="activeFeedbackId"
          @add="queueFeedback"
          @apply="applyFeedback"
          @remove="removeFeedback"
          @hover="activeFeedbackId = $event"
        />
      </aside>
    </div>

    <WriterFooter />
  </main>
</template>
