// Quick actions shown as chips on the floating toolbar. Each is a one-click
// preset: clicking a chip opens a session and immediately sends `prompt` about
// the selected text. The special `ask` action has an empty prompt — it just
// opens a panel for a free-form question (no auto-send).
//
// Shared between floatingButton.ts (renders the chips) and content.ts (looks up
// the prompt to auto-send), so the two never drift out of sync.

import type { LibraryPrompt } from './types'

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

// A good summary prompt, reused by the "Summarize this page" context-menu action.
export const SUMMARIZE_PAGE_PROMPT =
  'Summarize this page: give a 1-2 sentence overview, then the key points as bullets.'

// Built-in prompts offered in a panel's "/" menu. The user's own custom prompts
// (from chrome.storage.sync) are appended to these at runtime in content.ts.
export const BUILTIN_PROMPTS: LibraryPrompt[] = [
  { label: 'Explain', prompt: 'Explain this clearly and concisely.' },
  { label: 'Summarize', prompt: 'Summarize the key points in a few short bullets.' },
  { label: 'Simplify (ELI5)', prompt: 'Explain this in simple terms, as if to a beginner.' },
  { label: 'Key takeaways', prompt: 'List the key takeaways as bullet points.' },
  { label: 'Translate to English', prompt: 'Translate this to English.' },
  { label: 'Improve writing', prompt: 'Rewrite this to be clearer and more polished, keeping the meaning and language.' },
  { label: 'Fix grammar', prompt: 'Fix spelling and grammar mistakes and return the corrected text.' },
  { label: 'Define terms', prompt: 'Define the key terms or jargon here in plain language.' },
  { label: 'Counterargument', prompt: 'What are the strongest counterarguments or objections to this?' },
  { label: 'Action items', prompt: 'Extract any action items or to-dos as a checklist.' },
]
