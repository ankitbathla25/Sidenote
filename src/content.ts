import './content.css'
import { createFloatingButton, calculateButtonPosition } from './floatingButton'
import { promptForAction, SUMMARIZE_PAGE_PROMPT, BUILTIN_PROMPTS } from './actions'
import { createPanel, type Panel } from './panel'
import type { SelectionContext, StorageData, ApiConfig, Message, SavedSession, ImageSource, LibraryPrompt } from './types'
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
  // User-defined prompts for the panel's "/" menu (managed in the popup)
  customPrompts: LibraryPrompt[]
}

const config: ExtensionConfig = {
  apiKey: null,
  model: DEFAULT_MODEL,
  includePageContext: true,
  customPrompts: [],
}

// The full "/" menu library: built-in prompts plus the user's custom ones
const promptLibrary = (): LibraryPrompt[] => [...BUILTIN_PROMPTS, ...config.customPrompts]

// Load saved values when the content script first runs, then restore any
// sessions that were open on this page before a reload
chrome.storage.sync.get(
  ['claudeApiKey', 'claudeModel', 'includePageContext', 'customPrompts'],
  (result: StorageData) => {
    config.apiKey = result.claudeApiKey ?? null
    config.model = result.claudeModel ?? DEFAULT_MODEL
    // Unset means "on" — only an explicit false disables it
    config.includePageContext = result.includePageContext !== false
    config.customPrompts = result.customPrompts ?? []
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
    if (changes['customPrompts']) {
      config.customPrompts =
        (changes['customPrompts'].newValue as LibraryPrompt[]) ?? []
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

const floatingButton = createFloatingButton(onActionClick)

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
// This is inherently coupled to claude.ai's DOM. Their current markup tags user
// turns with [data-testid="user-message"] and assistant turns with the
// .font-claude-response class. We query both together so querySelectorAll
// returns them in conversation (document) order, then fall back to the legacy
// [data-message-author-role] attribute for other/older layouts. If nothing
// matches we return [] (and warn) so the panel degrades to selection-only
// context — it never throws.

// claude.ai (current)
const USER_SELECTOR = '[data-testid="user-message"]'
const ASSISTANT_SELECTOR = '.font-claude-response'

// Pulls role-tagged text out of a node list, keeping document order and
// dropping anything that isn't a clean user/assistant turn.
const collectMessages = (
  nodes: NodeListOf<Element>,
  roleOf: (el: Element) => string | null
): Message[] => {
  const messages: Message[] = []
  nodes.forEach((node) => {
    const role = roleOf(node)
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

const scrapeConversation = (): Message[] => {
  // Primary: claude.ai's current per-turn selectors, queried together so the
  // user/assistant turns come back interleaved in the right order.
  let messages = collectMessages(
    document.querySelectorAll(`${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`),
    (el) => (el.matches(USER_SELECTOR) ? 'user' : 'assistant')
  )

  // Fallback: older markup (and ChatGPT-style pages) carries the role on a
  // data attribute. Only consulted if the primary selectors matched nothing.
  if (messages.length === 0) {
    messages = collectMessages(
      document.querySelectorAll('[data-message-author-role]'),
      (el) => el.getAttribute('data-message-author-role')
    )
  }

  // Make the failure visible instead of silently sending selection-only context
  if (messages.length === 0 && /(^|\.)claude\.ai$/.test(location.hostname)) {
    console.warn(
      '[Sidenote] Captured 0 conversation messages on claude.ai — the page markup may have changed. Sending the selected text only.'
    )
  }

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

    // Save the context so onActionClick can use it
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

// Opens a brand-new session from a live selection. `initialPrompt` (from a
// quick-action chip) is auto-sent on open; omit it for a free-form ask.
const openPanelFromContext = (
  context: SelectionContext,
  initialPrompt = '',
  contextLabel = 'Selected text'
): void => {
  // Capture the whole on-page conversation so Claude answers with the same
  // context the user is looking at (empty on non-claude.ai pages). When the
  // user has turned page context off, send only the selection to save tokens.
  const seed = config.includePageContext ? scrapeConversation() : []

  // Visible at session-open time so context capture isn't a black box: tells you
  // whether page context is enabled and how many conversation turns were grabbed.
  console.debug(
    `[Sidenote] opening session — page context ${config.includePageContext ? 'ON' : 'OFF'}, ${seed.length} context message(s) captured`
  )

  const panel = createPanel({
    id: newId(),
    text: context.text,
    config: apiConfig(),
    seed,
    range: context.range,
    initialPrompt,
    contextLabel,
    promptLibrary: promptLibrary(),
    cascadeIndex: state.panels.length,
    onChange: schedulePersist,
    onDestroy: removePanel,
  })

  state.panels.push(panel)
  schedulePersist()
}

// ─── Image sessions ─────────────────────────────────────────────────────────────
// Fetches an image and encodes it as base64 in the page context. Works for
// same-origin/private images and data:/blob: URLs; throws for cross-origin
// images the page can't read (CORS), which the caller handles with a URL fallback.
const fetchImageAsBase64 = async (
  url: string
): Promise<{ media_type: string; data: string }> => {
  const blob = await (await fetch(url)).blob()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  // dataUrl looks like "data:image/png;base64,iVBORw0K…"
  const comma = dataUrl.indexOf(',')
  const media_type = dataUrl.slice(5, dataUrl.indexOf(';'))
  return { media_type, data: dataUrl.slice(comma + 1) }
}

// Turns a right-clicked image's src into something the vision API accepts.
const acquireImage = async (srcUrl: string): Promise<ImageSource> => {
  try {
    return { type: 'base64', ...(await fetchImageAsBase64(srcUrl)) }
  } catch {
    // Couldn't read it from the page — if it's a normal web URL, let Anthropic
    // fetch it server-side. (data:/blob: can't be fetched remotely, so re-throw.)
    if (/^https?:/i.test(srcUrl)) return { type: 'url', url: srcUrl }
    throw new Error('Could not load this image')
  }
}

// Opens a brand-new session about a right-clicked image
const openImagePanel = async (srcUrl: string): Promise<void> => {
  let image: ImageSource
  try {
    image = await acquireImage(srcUrl)
  } catch {
    showToast('Could not load that image.')
    return
  }

  const panel = createPanel({
    id: newId(),
    text: '', // image sessions aren't about selected text
    config: apiConfig(),
    seed: [],
    range: null,
    image,
    imagePreviewUrl: srcUrl,
    promptLibrary: promptLibrary(),
    cascadeIndex: state.panels.length,
    onChange: schedulePersist,
    onDestroy: removePanel,
  })

  state.panels.push(panel)
  schedulePersist()
}

// ─── Page summary ───────────────────────────────────────────────────────────────
// Scrapes the visible page text and opens a session that auto-summarizes it.
// innerText is the rendered, human-readable text; capped so a huge page doesn't
// blow up token usage.
const PAGE_TEXT_LIMIT = 16000

const scrapePageText = (): string =>
  (document.body?.innerText ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, PAGE_TEXT_LIMIT)

const openPageSummary = (): void => {
  const text = scrapePageText()
  if (!text) {
    showToast('<span>Nothing to summarize</span><strong>No readable text on this page.</strong>')
    return
  }
  openPanelFromContext({ text, range: null }, SUMMARIZE_PAGE_PROMPT, 'Page')
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
    image: saved.image,
    imagePreviewUrl: saved.imagePreviewUrl,
    promptLibrary: promptLibrary(),
    onChange: schedulePersist,
    onDestroy: removePanel,
  })

  state.panels.push(panel)
}

const restoreSessions = (): void => {
  void loadSessions().then((sessions) => sessions.forEach(restoreSession))
}

// ─── Floating toolbar click ─────────────────────────────────────────────────
// A chip was clicked. "ask" opens a free-form panel; every other action opens a
// panel and immediately sends its preset prompt about the selection.

function onActionClick(actionId: string): void {
  if (!state.pendingContext) return

  // Guard: make sure the user has set their API key
  if (!config.apiKey) {
    showNoApiKeyMessage()
    return
  }

  floatingButton.hide()
  openPanelFromContext(state.pendingContext, promptForAction(actionId))
  state.pendingContext = null
}

// ─── Background triggers ────────────────────────────────────────────────────────
// The context-menu item and keyboard shortcut both ask the background worker to
// send us this message; we open a session from whatever the user has selected.

chrome.runtime.onMessage.addListener(
  (message: { type?: string; srcUrl?: string }) => {
    const known = ['cir-ask-selection', 'cir-ask-image', 'cir-summarize-page']
    if (!message?.type || !known.includes(message.type)) return

    if (!config.apiKey) {
      showNoApiKeyMessage()
      return
    }

    if (message.type === 'cir-ask-image' && message.srcUrl) {
      void openImagePanel(message.srcUrl)
      return
    }

    if (message.type === 'cir-summarize-page') {
      openPageSummary()
      return
    }

    const context = getSelectionContext()
    if (context) openPanelFromContext(context)
  }
)

// ─── Toasts ─────────────────────────────────────────────────────────────────────
// Small inline notices instead of an alert() — much less jarring

// `body` is trusted HTML built by us (never user/page content)
const showToast = (body: string): void => {
  // Don't show multiple toasts at once
  if (document.querySelector('.cir-toast')) return

  const toast = document.createElement('div')
  toast.className = 'cir-toast'
  toast.innerHTML = body
  document.body.appendChild(toast)

  // Animate in
  requestAnimationFrame(() => toast.classList.add('cir-toast--visible'))

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    toast.classList.remove('cir-toast--visible')
    setTimeout(() => toast.remove(), 300)
  }, 4000)
}

const showNoApiKeyMessage = (): void =>
  showToast('<span>No API key set.</span><strong>Click the extension icon to add one.</strong>')