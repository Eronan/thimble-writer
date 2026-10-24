<script setup lang="ts">
import { countWords } from '~/utils/storyDiff'

const {
  draft,
  activeChapter,
  isBusy,
  models,
  loadingModels,
  generating,
  summarizing,
  revisingFeedback,
  proofreading,
  error,
  status,
  canUndo,
  previousStory,
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
  selectChapter,
  addChapter,
  removeChapter,
  fixingSynopsis,
  generatingSynopsisId,
  generatingAllStructure,
  generatingLoreId,
  fixChapterSynopsis,
  generateChapterSynopsis,
  generateAllChapterStructure,
  generateLoreEntry,
} = useStoryWriter()

const settingsOpen = ref(false)
const activeWorkspace = ref<'lore' | 'story' | 'chapters' | 'developer'>('lore')
const storyView = ref<'editor' | 'changes'>('editor')
const workspacePreferenceReady = ref(false)
const activeSummaryId = ref<string | null>(null)
const activeFeedbackId = ref<string | null>(null)
const activeSideTab = ref<'memory' | 'feedback'>('memory')
const storySelection = ref<{ start: number; end: number; text: string } | null>(null)
const feedbackPanel = ref<{ focusInstruction: () => void } | null>(null)

onMounted(() => {
  const savedWorkspace = localStorage.getItem('thimble-writer-workspace')
  if (savedWorkspace === 'lore' || savedWorkspace === 'story' || savedWorkspace === 'chapters' || savedWorkspace === 'developer') {
    activeWorkspace.value = savedWorkspace
  }
  workspacePreferenceReady.value = true
})

watch(activeWorkspace, (workspace) => {
  if (workspacePreferenceReady.value) {
    localStorage.setItem('thimble-writer-workspace', workspace)
  }
})

// A small badge on the Changes tab: how the word count moved since the last prompt.
const changeBadge = computed(() => {
  if (!canUndo.value) return ''
  const delta = countWords(activeChapter.value.story) - countWords(previousStory.value)
  return delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '±0'
})

function undoFromChanges() {
  undo()
  storyView.value = 'editor'
}

function queueFeedback(selection: { start: number; end: number; text: string }, instruction: string) {
  if (addFeedback(selection, instruction)) storySelection.value = null
}

function focusFeedbackComposer() {
  feedbackPanel.value?.focusInstruction()
}

function changeChapter(id: string) {
  selectChapter(id)
  storySelection.value = null
  activeSummaryId.value = null
  activeFeedbackId.value = null
  storyView.value = 'editor'
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
        :aria-pressed="activeWorkspace === 'chapters'"
        :class="{ active: activeWorkspace === 'chapters' }"
        @click="activeWorkspace = 'chapters'"
      >Story Structure</button>
      <button
        type="button"
        :aria-pressed="activeWorkspace === 'story'"
        :class="{ active: activeWorkspace === 'story' }"
        @click="activeWorkspace = 'story'"
      >Story Generator</button>
      <button
        type="button"
        class="dev-tab"
        :aria-pressed="activeWorkspace === 'developer'"
        :class="{ active: activeWorkspace === 'developer' }"
        @click="activeWorkspace = 'developer'"
      >Developer</button>
    </nav>

    <LorePanel
      v-if="activeWorkspace === 'lore'"
      v-model:synopsis="draft.synopsis"
      v-model:guidance="draft.guidance"
      v-model:characters="draft.characters"
      v-model:setting="draft.setting"
      :busy="isBusy"
      :model-available="Boolean(draft.model)"
      :generating-lore-id="generatingLoreId"
      :error="error"
      :status="status"
      @generate="generateLoreEntry"
    />

    <ChapterGenerator
      v-else-if="activeWorkspace === 'chapters'"
      v-model:chapters="draft.chapters"
      v-model:prompt="draft.structurePrompt"
      :busy="isBusy"
      :generating-chapter-id="generatingSynopsisId"
      :generating-all="generatingAllStructure"
      :chapter-count="draft.chapters.length"
      :model-available="Boolean(draft.model)"
      :error="error"
      :status="status"
      @generate="generateChapterSynopsis"
      @generate-all="generateAllChapterStructure"
      @add="addChapter"
      @remove="removeChapter"
    />

    <DeveloperPanel v-else-if="activeWorkspace === 'developer'" />

    <div v-else class="workspace">
      <ChapterHeader
        v-model:chapter="activeChapter"
        :chapters="draft.chapters"
        :busy="isBusy"
        @select="changeChapter"
        @add="addChapter"
      />
      <section class="story-panel">
        <nav class="side-panel-tabs story-view-tabs" role="tablist" aria-label="Story view">
          <button
            type="button"
            role="tab"
            :aria-selected="storyView === 'editor'"
            :class="{ active: storyView === 'editor' }"
            @click="storyView = 'editor'"
          >Editor</button>
          <button
            type="button"
            role="tab"
            :aria-selected="storyView === 'changes'"
            :class="{ active: storyView === 'changes' }"
            @click="storyView = 'changes'"
          >Changes <span v-if="changeBadge">{{ changeBadge }}</span></button>
        </nav>
        <StoryEditor
          v-if="storyView === 'editor'"
          v-model="activeChapter.story"
          :chapter-title="activeChapter.title"
          :can-undo="canUndo"
          :generating="generating"
          :busy="isBusy"
          :fixing-synopsis="fixingSynopsis"
          :summaries="activeChapter.summaries"
          :active-summary-id="activeSummaryId"
          :feedback="activeChapter.feedback"
          :active-feedback-id="activeFeedbackId"
          @undo="undo"
          @comment="focusFeedbackComposer"
          @selection="storySelection = $event"
          @fix-synopsis="fixChapterSynopsis"
        />
        <StoryChanges
          v-else
          :before="previousStory"
          :after="activeChapter.story"
          :can-undo="canUndo"
          :busy="generating || revisingFeedback"
          :revisions="activeChapter.feedbackRevisions"
          @undo="undoFromChanges"
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
        <nav class="side-panel-tabs" role="tablist" aria-label="Story tools">
          <button
            id="memory-tab"
            type="button"
            role="tab"
            :aria-selected="activeSideTab === 'memory'"
            aria-controls="memory-panel"
            :class="{ active: activeSideTab === 'memory' }"
            @click="activeSideTab = 'memory'"
          >Memory <span>{{ activeChapter.summaries.length }}</span></button>
          <button
            id="feedback-tab"
            type="button"
            role="tab"
            :aria-selected="activeSideTab === 'feedback'"
            aria-controls="feedback-panel"
            :class="{ active: activeSideTab === 'feedback' }"
            @click="activeSideTab = 'feedback'"
          >Feedback <span>{{ activeChapter.feedback.length }}</span></button>
        </nav>
        <div
          id="memory-panel"
          class="side-panel-content"
          role="tabpanel"
          aria-labelledby="memory-tab"
          v-show="activeSideTab === 'memory'"
        >
          <StoryMemory
            v-model="activeChapter.summaries"
            :story="activeChapter.story"
            :busy="summarizing || generating || revisingFeedback"
            :model-available="Boolean(draft.model)"
            :active-summary-id="activeSummaryId"
            :visible="activeSideTab === 'memory'"
            @summarize="summarizeOlderSections()"
            @remove="removeSummary"
            @hover="activeSummaryId = $event"
          />
        </div>
        <div
          id="feedback-panel"
          class="side-panel-content"
          role="tabpanel"
          aria-labelledby="feedback-tab"
          v-show="activeSideTab === 'feedback'"
        >
          <StoryFeedbackPanel
            ref="feedbackPanel"
            v-model="activeChapter.feedback"
            :story="activeChapter.story"
            :revisions="activeChapter.feedbackRevisions"
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
            @show-changes="storyView = 'changes'"
          />
        </div>
      </aside>
    </div>

    <WriterFooter />
  </main>
</template>
