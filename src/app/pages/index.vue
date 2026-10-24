<script setup lang="ts">
const {
  draft,
  models,
  loadingModels,
  generating,
  summarizing,
  error,
  status,
  canUndo,
  selectedModelSize,
  refreshModels,
  summarizeOlderSections,
  removeSummary,
  writeNext,
  undo,
} = useStoryWriter()

const settingsOpen = ref(false)
const activeSummaryId = ref<string | null>(null)
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
          @undo="undo"
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
      <StoryMemory
        v-model="draft.summaries"
        :story="draft.story"
        :busy="summarizing || generating"
        :model-available="Boolean(draft.model)"
        :active-summary-id="activeSummaryId"
        @summarize="summarizeOlderSections()"
        @remove="removeSummary"
        @hover="activeSummaryId = $event"
      />
    </div>

    <WriterFooter />
  </main>
</template>
