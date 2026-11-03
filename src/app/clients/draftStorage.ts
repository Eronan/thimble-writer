export type DraftStorage = {
  load: () => Promise<string | null>
  save: (serializedDraft: string) => Promise<void>
  backup: (serializedDraft: string, label: string) => Promise<void>
}

const draftKey = 'thimble-writer-v1'

// Keep persistence behind an async-shaped boundary so replacing localStorage with IndexedDB
// later does not spread storage concerns through the writer UI and generation flow.
export const draftStorage: DraftStorage = {
  async load() {
    return localStorage.getItem(draftKey)
  },
  async save(serializedDraft) {
    localStorage.setItem(draftKey, serializedDraft)
  },
  // Copies of a save we are about to migrate or could not read. Never overwritten by autosave.
  async backup(serializedDraft, label) {
    localStorage.setItem(`${draftKey}-backup-${label}`, serializedDraft)
  },
}
