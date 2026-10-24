<script setup lang="ts">
const {
  draft,
  models,
  loadingModels,
  generating,
  error,
  status,
  canUndo,
  selectedModelSize,
  refreshModels,
  writeNext,
  undo,
} = useStoryWriter()

const settingsOpen = ref(false)
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
        <StoryEditor v-model="draft.story" :can-undo="canUndo" :generating="generating" @undo="undo" />
        <PromptComposer
          v-model="draft.prompt"
          :error="error"
          :status="status"
          :generating="generating"
          :model-available="Boolean(draft.model)"
          @write="writeNext"
        />
      </section>
    </div>

    <WriterFooter />
  </main>
</template>
