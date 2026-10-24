export type DraftStorage = {
  load: () => Promise<string | null>
  save: (serializedDraft: string) => Promise<void>
}

// Keep persistence behind an async-shaped boundary so replacing localStorage with IndexedDB
// later does not spread storage concerns through the writer UI and generation flow.
export const draftStorage: DraftStorage = {
  async load() {
    return localStorage.getItem('thimble-writer-v1')
  },
  async save(serializedDraft) {
    localStorage.setItem('thimble-writer-v1', serializedDraft)
  },
}
