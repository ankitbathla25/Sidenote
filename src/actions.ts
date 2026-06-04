// Quick actions shown as chips on the floating toolbar. Each is a one-click
// preset: clicking a chip opens a session and immediately sends `prompt` about
// the selected text. The special `ask` action has an empty prompt — it just
// opens a panel for a free-form question (no auto-send).
//
// Shared between floatingButton.ts (renders the chips) and content.ts (looks up
// the prompt to auto-send), so the two never drift out of sync.

export interface QuickAction {
  id: string
  label: string
  // The message auto-sent about the selection. Empty string = open only.
  prompt: string
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'ask', label: 'Ask', prompt: '' },
  { id: 'explain', label: 'Explain', prompt: 'Explain this clearly and concisely.' },
  { id: 'summarize', label: 'Summarize', prompt: 'Summarize the key points in a few short bullets.' },
  { id: 'simplify', label: 'Simplify', prompt: 'Explain this in simple terms, as if to a beginner.' },
]

export const promptForAction = (id: string): string =>
  QUICK_ACTIONS.find((a) => a.id === id)?.prompt ?? ''
