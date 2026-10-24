<script setup lang="ts">
const lore = defineModel<string>({ required: true })
</script>

<template>
  <aside class="lore-panel">
    <div class="section-heading">
      <div>
        <p class="eyebrow">YOUR STORY BIBLE</p>
        <h1>Lore</h1>
      </div>
      <span class="count-pill">{{ lore.length.toLocaleString() }}</span>
    </div>
    <p class="section-description">Keep the details your story should remember: characters, places, history, and rules.</p>
    <textarea
      v-model="lore"
      class="lore-input"
      aria-label="Lore"
      placeholder="A few details about your world…&#10;&#10;Mara is a cartographer who can hear the memories of places."
    />
    <div class="lore-tip">
      <span class="tip-icon" aria-hidden="true">✦</span>
      <p><strong>A little lore goes a long way.</strong><br>Separate notes with a blank line to keep ideas distinct.</p>
    </div>
  </aside>
</template>
