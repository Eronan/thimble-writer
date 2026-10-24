<script setup lang="ts">
const {
  draft,
  models,
  loadingModels,
  generating,
  summarizing,
  revisingFeedback,
  proofreading,
  error,
  status,
  canUndo,
  selectedModelSize,
  contextPreview,
  refreshModels,
  summarizeOlderSections,
  removeSummary,
  addFeedback,
  applyFeedback,
  proofreadStory,
  removeFeedback,
  writeNext,
  undo,
} = useStoryWriter()

const settingsOpen = ref(false)
const activeWorkspace = ref<'lore' | 'story'>('story')
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

    <nav class="workspace-tabs" aria-label="Workspace">
      <button
        type="button"
        :aria-pressed="activeWorkspace === 'lore'"
        :class="{ active: activeWorkspace === 'lore' }"
        @click="activeWorkspace = 'lore'"
      >Lore</button>
      <button
        type="button"
        :aria-pressed="activeWorkspace === 'story'"
        :class="{ active: activeWorkspace === 'story' }"
        @click="activeWorkspace = 'story'"
      >Story Generator</button>
    </nav>

    <LorePanel
      v-if="activeWorkspace === 'lore'"
      v-model:synopsis="draft.synopsis"
      v-model:guidance="draft.guidance"
      v-model:characters="draft.characters"
      v-model:setting="draft.setting"
    />

    <div v-else class="workspace">
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
          :context-preview="contextPreview"
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
          :busy="summarizing || generating || revisingFeedback || proofreading"
          :model-available="Boolean(draft.model)"
          :active-feedback-id="activeFeedbackId"
          :proofreading="proofreading"
          @add="queueFeedback"
          @apply="applyFeedback"
          @proofread="proofreadStory"
          @remove="removeFeedback"
          @hover="activeFeedbackId = $event"
        />
      </aside>
    </div>

    <WriterFooter />
  </main>
</template>
