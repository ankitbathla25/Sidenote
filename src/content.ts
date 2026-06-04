import './content.css'
import { createFloatingButton, calculateButtonPosition } from './floatingButton'
import { createPanel, type Panel } from './panel'
import type { SelectionContext, StorageData, ApiConfig, Message, SavedSession } from './types'
import { DEFAULT_MODEL } from './api'
import { loadSessions, saveSessions } from './storage'

// ─── Storage ──────────────────────────────────────────────────────────────────
// Read config from chrome.storage once on load, then keep it in sync
// We store it in a plain object so every function can read it without
// making async storage calls on every keypress or mouse event

interface ExtensionConfig {
  apiKey: string | null
  model: string
  // Send the whole on-page conversation as context, or just the selection.
  // Defaults to true; the user can turn it off in the popup to save tokens.
  includePageContext: boolean
}

const config: ExtensionConfig = {
  apiKey: null,
  model: DEFAULT_MODEL,
  includePageContext: true,
}

// Load saved values when the content script first runs, then restore any
// sessions that were open on this page before a reload
chrome.storage.sync.get(
  ['claudeApiKey', 'claudeModel', 'includePageContext'],
  (result: StorageData) => {
    config.apiKey = result.claudeApiKey ?? null
    config.model = result.claudeModel ?? DEFAULT_MODEL
    // Unset means "on" — only an explicit false disables it
    config.includePageContext = result.includePageContext !== false
    // Restore after config is set so restored panels capture a valid API key
    restoreSessions()
  }
)

// Snapshot of the current API config, handed to each panel as it's created
const apiConfig = (): ApiConfig => ({
  apiKey: config.apiKey ?? '',
  model: config.model,
})

// Keep config in sync if the user changes settings while the page is open
chrome.storage.onChanged.addListener(
  (changes: { [key: string]: chrome.storage.StorageChange }) => {
    if (changes['claudeApiKey']) {
      config.apiKey = changes['claudeApiKey'].newValue as string ?? null
    }
    if (changes['claudeModel']) {
      config.model = changes['claudeModel'].newValue as string ?? DEFAULT_MODEL
    }
    if (changes['includePageContext']) {
      config.includePageContext =
        changes['includePageContext'].newValue !== false
    }
  }
)

// ─── State ────────────────────────────────────────────────────────────────────
// Everything that can change while the user is on the page
// One object, defined once, mutated explicitly

interface PageState {
  pendingContext: SelectionContext | null
  // Every open session is its own panel — we keep them all so the user can
  // run several inline conversations at once
  panels: Panel[]
}

const state: PageState = {
  pendingContext: null,
  panels: [],
}

// ─── Floating button ──────────────────────────────────────────────────────────
// Created once, reused for every selection

const floatingButton = createFloatingButton(onAskClick)

// ─── Selection detection ──────────────────────────────────────────────────────

const getSelectionContext = (): SelectionContext | null => {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''

  // Ignore selections that are too short to be meaningful
  if (text.length < 5 || !sel || sel.rangeCount === 0) return null

  // Ignore selections made inside our own UI (panel, dock, button) so the
  // extension doesn't react to itself
  const anchor = sel.anchorNode
  if (anchor && isInsideOwnUI(anchor)) return null

  return {
    text,
    range: sel.getRangeAt(0).cloneRange(),
    // cloneRange is important — the selection object is live and
    // changes as soon as the user clicks elsewhere. We clone it
    // so we have a stable snapshot of where the text was.
  }
}

// True if the node sits inside any of the extension's own UI elements
const isInsideOwnUI = (node: Node): boolean => {
  let el: Element | null =
    node.nodeType === Node.TEXT_NODE
      ? (node as Text).parentElement
      : (node as Element)

  while (el) {
    const cls = el.classList
    if (
      cls &&
      (cls.contains('cir-panel') ||
        cls.contains('cir-minimized') ||
        cls.contains('cir-float-btn') ||
        cls.contains('cir-dock'))
    ) {
      return true
    }
    el = el.parentElement
  }
  return false
}

// ─── Conversation scraping ──────────────────────────────────────────────────────
// Reads the full conversation currently rendered on the claude.ai page so the
// panel's Claude shares the same context — not just the highlighted snippet.
//
// This is inherently coupled to claude.ai's DOM: messages are marked with a
// data-message-author-role attribute ("user" | "assistant"). If that markup
// ever changes we simply return [] and the panel falls back to selection-only
// context — it never throws.

const scrapeConversation = (): Message[] => {
  const nodes = document.querySelectorAll('[data-message-author-role]')

  const messages: Message[] = []
  nodes.forEach((node) => {
    const role = node.getAttribute('data-message-author-role')
    // Only the two roles the Anthropic API accepts
    if (role !== 'user' && role !== 'assistant') return

    // innerText gives us the rendered, human-readable text — close to what
    // the user actually sees, without HTML tags
    const text = (node as HTMLElement).innerText.trim()
    if (!text) return

    messages.push({ role, content: text })
  })

  return messages
}

// ─── Event: mouseup ───────────────────────────────────────────────────────────
// Fires after the user finishes making a selection

document.addEventListener('mouseup', () => {
  // Small delay — the selection object isn't always finalised
  // at the exact moment mouseup fires
  setTimeout(() => {
    const context = getSelectionContext()

    if (!context || !context.range) {
      floatingButton.hide()
      return
    }

    // Save the context so onAskClick can use it
    state.pendingContext = context

    // Position and show the button near the selection
    const rect = context.range.getBoundingClientRect()
    const position = calculateButtonPosition(rect)
    floatingButton.show(position)
  }, 30)
})

// ─── Event: mousedown ─────────────────────────────────────────────────────────
// Fires before click — used to detect outside clicks

document.addEventListener('mousedown', (e: MouseEvent) => {
  const target = e.target as Node

  const clickedInsidePanel = state.panels.some((p) => p.contains(target))
  const clickedInsideButton = floatingButton.contains(target)

  // Clicked outside the button and every panel:
  // hide the button and collapse all open panels to their minimized icons
  if (!clickedInsideButton && !clickedInsidePanel) {
    floatingButton.hide()
    state.panels.forEach((panel) => panel.minimize())
  }
})

// ─── Event: keydown ───────────────────────────────────────────────────────────
// Close the panel when the user presses Escape

document.addEventListener('keydown', (e: KeyboardEvent) => {
  // Escape closes the most recently opened panel (its onDestroy callback
  // removes it from state.panels)
  if (e.key === 'Escape' && state.panels.length > 0) {
    state.panels[state.panels.length - 1].destroy()
  }
})

// ─── Persistence ────────────────────────────────────────────────────────────────
// Save the open sessions to storage so they survive a reload. Writes are
// debounced so dragging/typing doesn't hammer storage.

let saveTimer: number | undefined

const schedulePersist = (): void => {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void saveSessions(state.panels.map((p) => p.serialize()))
  }, 400)
}

// Drop a panel from the open list (called when a panel closes itself)
const removePanel = (id: string): void => {
  state.panels = state.panels.filter((p) => p.id !== id)
  schedulePersist()
}

const newId = (): string =>
  crypto.randomUUID?.() ?? `cir-${Date.now()}-${Math.random().toString(36).slice(2)}`

// ─── Opening / restoring panels ─────────────────────────────────────────────────

// Opens a brand-new session from a live selection
const openPanelFromContext = (context: SelectionContext): void => {
  // Capture the whole on-page conversation so Claude answers with the same
  // context the user is looking at (empty on non-claude.ai pages). When the
  // user has turned page context off, send only the selection to save tokens.
  const seed = config.includePageContext ? scrapeConversation() : []

  const panel = createPanel({
    id: newId(),
    text: context.text,
    config: apiConfig(),
    seed,
    range: context.range,
    cascadeIndex: state.panels.length,
    onChange: schedulePersist,
    onDestroy: removePanel,
  })

  state.panels.push(panel)
  schedulePersist()
}

// Re-creates a session saved before a page reload
const restoreSession = (saved: SavedSession): void => {
  const panel = createPanel({
    id: saved.id,
    text: saved.text,
    config: apiConfig(),
    seed: saved.seed,
    range: null, // the original selection no longer exists
    messages: saved.messages,
    geometry: saved.geometry,
    startMinimized: saved.minimized,
    onChange: schedulePersist,
    onDestroy: removePanel,
  })

  state.panels.push(panel)
}

const restoreSessions = (): void => {
  void loadSessions().then((sessions) => sessions.forEach(restoreSession))
}

// ─── Ask button click ─────────────────────────────────────────────────────────

function onAskClick(): void {
  if (!state.pendingContext) return

  // Guard: make sure the user has set their API key
  if (!config.apiKey) {
    showNoApiKeyMessage()
    return
  }

  floatingButton.hide()
  openPanelFromContext(state.pendingContext)
  state.pendingContext = null
}

// ─── Background triggers ────────────────────────────────────────────────────────
// The context-menu item and keyboard shortcut both ask the background worker to
// send us this message; we open a session from whatever the user has selected.

chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type !== 'cir-ask-selection') return

  if (!config.apiKey) {
    showNoApiKeyMessage()
    return
  }

  const context = getSelectionContext()
  if (context) openPanelFromContext(context)
})

// ─── No API key message ───────────────────────────────────────────────────────
// Shown inline instead of an alert() — much less jarring

const showNoApiKeyMessage = (): void => {
  // Don't show multiple toasts at once
  if (document.querySelector('.cir-toast')) return

  const toast = document.createElement('div')
  toast.className = 'cir-toast'
  toast.innerHTML = `
    <span>No API key set.</span>
    <strong>Click the extension icon to add one.</strong>
  `
  document.body.appendChild(toast)

  // Animate in
  requestAnimationFrame(() => toast.classList.add('cir-toast--visible'))

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    toast.classList.remove('cir-toast--visible')
    setTimeout(() => toast.remove(), 300)
  }, 4000)
}