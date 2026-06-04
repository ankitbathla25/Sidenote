import { renderMarkdown, escapeHtml } from './markdown'
import { sendMessage } from './api'
import type {
  Message,
  ApiConfig,
  PanelGeometry,
  SavedSession,
  Usage,
  ImageSource,
} from './types'

// ─── DOM Builders ────────────────────────────────────────────────────────────
// Each function builds one piece of the panel's HTML
// Pure functions — they take data and return DOM elements, nothing else

const createPanelShell = (previewText: string): HTMLDivElement => {
  const panel = document.createElement('div')
  panel.className = 'cir-panel'
  panel.innerHTML = `
    <div class="cir-panel-header">
      <div class="cir-panel-title">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span>Sidenote</span>
      </div>
      <div class="cir-header-actions">
        <button class="cir-close-btn" aria-label="Close panel">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>

    <div class="cir-context-preview">
      <div class="cir-context-label">Selected text</div>
      <div class="cir-context-text">${previewText}</div>
    </div>

    <div class="cir-messages"></div>

    <div class="cir-input-area">
      <textarea
        class="cir-textarea"
        placeholder="Ask about the selected text…"
        rows="2"
        aria-label="Your question"
      ></textarea>
      <button class="cir-send-btn" aria-label="Send question">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>

    <div class="cir-resize-handle cir-resize-nw" data-dir="nw" aria-hidden="true"></div>
    <div class="cir-resize-handle cir-resize-ne" data-dir="ne" aria-hidden="true"></div>
    <div class="cir-resize-handle cir-resize-sw" data-dir="sw" aria-hidden="true"></div>
    <div class="cir-resize-handle cir-resize-se" data-dir="se" aria-hidden="true"></div>
  `
  return panel
}

// All minimized icons live in a single fixed dock at the bottom-right so they
// stack neatly instead of overlapping, no matter how many sessions are open.
let dockEl: HTMLDivElement | null = null

const getDock = (): HTMLDivElement => {
  if (!dockEl || !dockEl.isConnected) {
    dockEl = document.createElement('div')
    dockEl.className = 'cir-dock'
    document.body.appendChild(dockEl)
  }
  return dockEl
}

// Builds the labelled pill the panel collapses into when minimized.
// The pill shows a short snippet of the selected text; hovering reveals the
// fuller description in a tooltip.
const createMinimizedIcon = (description: string): HTMLDivElement => {
  const short =
    description.length > 28 ? description.slice(0, 28).trimEnd() + '…' : description

  const icon = document.createElement('div')
  icon.className = 'cir-minimized'
  icon.setAttribute('role', 'button')
  icon.setAttribute('aria-label', `Expand session about: ${description}`)
  icon.title = description // native tooltip as a fallback

  icon.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
    <span class="cir-minimized-label"></span>
    <span class="cir-minimized-tip"></span>
  `

  // textContent (not innerHTML) so the selected text can never inject markup
  ;(icon.querySelector('.cir-minimized-label') as HTMLElement).textContent = short
  ;(icon.querySelector('.cir-minimized-tip') as HTMLElement).textContent = description

  return icon
}

// Builds a single chat bubble — user or assistant
const createMessageElement = (
  role: 'user' | 'assistant',
  text: string
): HTMLDivElement => {
  const div = document.createElement('div')
  div.className = `cir-message cir-message-${role}`
  // User messages are plain text — never render user input as HTML
  // Assistant messages are markdown — safe because we escaped HTML first
  div.innerHTML = role === 'assistant' ? renderMarkdown(text) : escapeHtml(text)
  return div
}

// Builds the three animated dots shown while waiting for a response
const createThinkingElement = (): HTMLDivElement => {
  const div = document.createElement('div')
  div.className = 'cir-thinking'
  div.innerHTML = '<span></span><span></span><span></span>'
  return div
}

// Builds an error bubble
const createErrorElement = (message: string): HTMLDivElement => {
  const div = document.createElement('div')
  div.className = 'cir-error'
  div.textContent = `⚠ ${message}`
  return div
}

// Compact "1.2k" style number — keeps the usage line short
const formatTokens = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`

// Builds the tiny per-turn usage line shown under an assistant reply. It makes
// prompt caching visible: `cached` is the slice of the prompt that was re-read
// at ~10% price instead of being sent in full. Returns null when the API gave
// us no usage data (so we render nothing rather than an empty row).
const createUsageElement = (usage: Usage | undefined): HTMLDivElement | null => {
  if (!usage) return null

  const cached = usage.cache_read_input_tokens ?? 0
  // Full-price input = the uncached remainder plus anything written to cache
  // this turn (a cache write is billed at ~1.25×, not free)
  const fullPriceIn = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0)

  const parts = [`↑ ${formatTokens(fullPriceIn)} in`, `↓ ${formatTokens(usage.output_tokens)} out`]
  if (cached > 0) parts.push(`⚡ ${formatTokens(cached)} cached`)

  const div = document.createElement('div')
  div.className = 'cir-usage'
  div.textContent = parts.join(' · ')
  div.title = cached > 0
    ? `${cached.toLocaleString()} tokens served from cache at ~10% price`
    : 'No cache hit this turn (prefix too short or first turn)'
  return div
}

// ─── Highlight ───────────────────────────────────────────────────────────────

// Wraps the selected text in a <mark> so the user can see what they asked about
const applyHighlight = (range: Range): HTMLElement | null => {
  try {
    const mark = document.createElement('mark')
    mark.className = 'cir-highlight'
    range.surroundContents(mark)
    return mark
  } catch {
    // surroundContents throws if the range spans multiple parent elements
    // e.g. selecting text across a <p> boundary — we just skip the highlight
    return null
  }
}

// Unwraps the <mark> element, putting the original text nodes back
const removeHighlight = (mark: HTMLElement | null): void => {
  if (!mark || !mark.parentNode) return
  while (mark.firstChild) {
    mark.parentNode.insertBefore(mark.firstChild, mark)
  }
  mark.parentNode.removeChild(mark)
}

// ─── Positioning ─────────────────────────────────────────────────────────────

// Calculates the top position for the panel so it sits beside the selection
// Clamps it so it never goes off the top or bottom of the viewport
const calculatePanelTop = (range: Range): number => {
  const rects = range.getClientRects()
  if (rects.length === 0) return window.scrollY + 80

  const firstRect = rects[0]
  const topAbs = firstRect.top + window.scrollY
  const maxTop = window.scrollY + window.innerHeight - 500 // 500 ≈ panel height

  return Math.min(Math.max(topAbs, window.scrollY + 16), maxTop)
}

// ─── Scroll helpers ───────────────────────────────────────────────────────────

const scrollMessagesToBottom = (messagesEl: HTMLDivElement): void => {
  messagesEl.scrollTop = messagesEl.scrollHeight
}

// ─── Auto-grow textarea ───────────────────────────────────────────────────────

const autoGrowTextarea = (textarea: HTMLTextAreaElement): void => {
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
}

// ─── Dragging ──────────────────────────────────────────────────────────────────
// Lets the user reposition the panel by dragging its header. On the first drag we
// convert the panel from right-anchored to absolute left/top page coordinates so
// it stays exactly where it's dropped — anywhere on the page.
// Returns a cleanup function that detaches every listener it added.

const makeDraggable = (
  panel: HTMLDivElement,
  handle: HTMLElement,
  onEnd: () => void
): (() => void) => {
  let startX = 0
  let startY = 0
  let startLeft = 0
  let startTop = 0
  let dragging = false

  const onMouseMove = (e: MouseEvent): void => {
    if (!dragging) return
    panel.style.left = `${startLeft + (e.clientX - startX)}px`
    panel.style.top = `${startTop + (e.clientY - startY)}px`
  }

  const onMouseUp = (): void => {
    if (!dragging) return
    dragging = false
    panel.classList.remove('cir-panel-dragging')
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    onEnd() // persist the new position
  }

  const onMouseDown = (e: MouseEvent): void => {
    // Don't start a drag when the user clicks a control in the header
    // (e.g. the close button)
    if ((e.target as HTMLElement).closest('button')) return

    e.preventDefault() // stops the browser starting a text selection

    // Convert the panel's current on-screen position into absolute page
    // coordinates so we can move it freely from this point on
    const rect = panel.getBoundingClientRect()
    startLeft = rect.left + window.scrollX
    startTop = rect.top + window.scrollY
    panel.style.left = `${startLeft}px`
    panel.style.top = `${startTop}px`
    panel.style.right = 'auto' // release the original right anchor

    startX = e.clientX
    startY = e.clientY
    dragging = true
    panel.classList.add('cir-panel-dragging')

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  handle.addEventListener('mousedown', onMouseDown)

  return () => {
    handle.removeEventListener('mousedown', onMouseDown)
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
}

// ─── Resizing ──────────────────────────────────────────────────────────────────
// Lets the user resize the panel from any of its four corners. Each corner keeps
// the two opposite edges anchored, so the panel grows/shrinks toward the corner
// being dragged. Clamped to sensible minimums so it never collapses to nothing.
// Returns a cleanup function that detaches every listener it added.

const MIN_PANEL_WIDTH = 280
const MIN_PANEL_HEIGHT = 220

const makeResizable = (
  panel: HTMLDivElement,
  handles: HTMLElement[],
  onEnd: () => void
): (() => void) => {
  let startX = 0
  let startY = 0
  let startLeft = 0
  let startTop = 0
  let startRight = 0
  let startBottom = 0
  let dir = ''
  let resizing = false

  const onMouseMove = (e: MouseEvent): void => {
    if (!resizing) return

    const dx = e.clientX - startX
    const dy = e.clientY - startY

    let left = startLeft
    let top = startTop
    let width = startRight - startLeft
    let height = startBottom - startTop

    // Horizontal: east edge moves with the pointer, west edge stays anchored
    if (dir.includes('e')) {
      width = Math.max(MIN_PANEL_WIDTH, startRight - startLeft + dx)
    } else if (dir.includes('w')) {
      width = Math.max(MIN_PANEL_WIDTH, startRight - startLeft - dx)
      left = startRight - width // keep the right edge fixed
    }

    // Vertical: south edge moves with the pointer, north edge stays anchored
    if (dir.includes('s')) {
      height = Math.max(MIN_PANEL_HEIGHT, startBottom - startTop + dy)
    } else if (dir.includes('n')) {
      height = Math.max(MIN_PANEL_HEIGHT, startBottom - startTop - dy)
      top = startBottom - height // keep the bottom edge fixed
    }

    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
    panel.style.width = `${width}px`
    panel.style.height = `${height}px`
  }

  const onMouseUp = (): void => {
    if (!resizing) return
    resizing = false
    panel.classList.remove('cir-panel-resizing')
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    onEnd() // persist the new size
  }

  const onMouseDown = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation() // don't let this bubble to the document outside-click handler

    dir = (e.currentTarget as HTMLElement).dataset.dir ?? 'se'

    // Snapshot the panel's edges in absolute page coordinates so every corner
    // works the same way regardless of the panel's current anchoring
    const rect = panel.getBoundingClientRect()
    startLeft = rect.left + window.scrollX
    startTop = rect.top + window.scrollY
    startRight = startLeft + rect.width
    startBottom = startTop + rect.height
    startX = e.clientX
    startY = e.clientY
    resizing = true

    // The shell caps height with max-height and anchors via right; release both
    // so we can drive left/top/width/height directly
    panel.style.maxHeight = 'none'
    panel.style.right = 'auto'
    panel.classList.add('cir-panel-resizing')

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  handles.forEach((handle) => handle.addEventListener('mousedown', onMouseDown))

  return () => {
    handles.forEach((handle) => handle.removeEventListener('mousedown', onMouseDown))
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
}

// ─── Panel state ─────────────────────────────────────────────────────────────
// A plain object that holds all mutable state for one panel instance
// We pass this around explicitly instead of using class fields or global vars

interface PanelState {
  // The page conversation captured as context — sent to the API, never rendered
  seed: Message[]
  // The panel's own Q&A — both rendered in the UI and sent to the API
  messages: Message[]
  isLoading: boolean
  highlightMark: HTMLElement | null
}

const createInitialState = (): PanelState => ({
  seed: [],
  messages: [],
  isLoading: false,
  highlightMark: null,
})

// Builds the system prompt. For image sessions the picture is attached to the
// first user turn, so the prompt just frames the task. For text sessions the
// seed gives Claude the conversation and this points at the highlighted passage.
const buildSystemPrompt = (selectedText: string, hasImage: boolean): string => {
  if (hasImage) {
    return `
You are a helpful assistant. The user has shared an image (attached to their
first message) and wants to ask about it. Answer based on what's in the image.
Be concise. Use markdown formatting when it helps clarity.
    `.trim()
  }

  return `
You are a helpful assistant. The preceding messages are the conversation the
user is currently reading. The user has highlighted a specific passage from it
and wants to ask about that passage.

The highlighted text is:
"""
${selectedText}
"""

Answer using the full conversation as context, but stay focused on the
highlighted passage. Be concise. Use markdown formatting when it helps clarity.
  `.trim()
}

// ─── Send handler ─────────────────────────────────────────────────────────────

const handleSend = async (
  state: PanelState,
  config: ApiConfig,
  selectedText: string,
  image: ImageSource | undefined,
  messagesEl: HTMLDivElement,
  textarea: HTMLTextAreaElement,
  sendBtn: HTMLButtonElement,
  onChange: () => void
): Promise<void> => {
  const text = textarea.value.trim()
  if (!text || state.isLoading) return

  // Clear input immediately so the user knows their message was received
  textarea.value = ''
  textarea.style.height = 'auto'

  // Disable send while waiting — prevent double sends
  state.isLoading = true
  sendBtn.disabled = true

  // Show user message — keep a handle so we can pull it back out on failure
  const userMessageEl = createMessageElement('user', text)
  messagesEl.appendChild(userMessageEl)
  scrollMessagesToBottom(messagesEl)

  // Record the turn so Claude has full conversation context
  state.messages.push({ role: 'user', content: text })
  onChange() // persist the new question right away

  // Show thinking dots until the first streamed token arrives
  const thinking = createThinkingElement()
  messagesEl.appendChild(thinking)
  scrollMessagesToBottom(messagesEl)

  // The assistant bubble is created lazily on the first text delta, then
  // re-rendered as more text streams in.
  let assistantEl: HTMLDivElement | null = null
  let streamed = ''

  try {
    // The request history is the captured page context plus this panel's Q&A.
    // onText fires for every streamed chunk so the answer appears live.
    const reply = await sendMessage(
      config,
      buildSystemPrompt(selectedText, !!image),
      [...state.seed, ...state.messages],
      (chunk) => {
        if (!assistantEl) {
          thinking.remove()
          assistantEl = createMessageElement('assistant', '')
          messagesEl.appendChild(assistantEl)
        }
        const el = assistantEl
        streamed += chunk
        el.innerHTML = renderMarkdown(streamed)
        scrollMessagesToBottom(messagesEl)
      },
      image
    )

    // Make sure a bubble exists (e.g. an empty reply produced no deltas), then
    // do a final authoritative render of the complete text.
    if (!assistantEl) {
      thinking.remove()
      assistantEl = createMessageElement('assistant', reply.text)
      messagesEl.appendChild(assistantEl)
    } else {
      ;(assistantEl as HTMLDivElement).innerHTML = renderMarkdown(reply.text)
    }

    state.messages.push({ role: 'assistant', content: reply.text })
    // Surface this turn's token usage (and any cache savings) under the reply.
    // Display-only — not part of state.messages, so it isn't persisted or resent.
    const usageEl = createUsageElement(reply.usage)
    if (usageEl) messagesEl.appendChild(usageEl)
    scrollMessagesToBottom(messagesEl)
    onChange() // persist the answer
  } catch (err: unknown) {
    thinking.remove()
    if (assistantEl) (assistantEl as HTMLDivElement).remove()
    const message = err instanceof Error ? err.message : 'Something went wrong'
    // Remove the failed user message from both the transcript and the DOM so
    // the visible panel and the conversation state stay in agreement (an
    // orphaned bubble would otherwise show a question that was never sent)
    state.messages.pop()
    userMessageEl.remove()
    messagesEl.appendChild(createErrorElement(message))
    scrollMessagesToBottom(messagesEl)
    onChange()
  } finally {
    state.isLoading = false
    sendBtn.disabled = false
    textarea.focus()
  }
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface Panel {
  id: string
  contains: (node: Node) => boolean
  minimize: () => void
  destroy: () => void
  serialize: () => SavedSession
}

export interface CreatePanelOptions {
  id: string
  // The selected text the session is about — used for the preview, the system
  // prompt, the minimized label, and (for live sessions) the highlight target
  text: string
  config: ApiConfig
  // The page conversation captured as context (sent, not rendered)
  seed: Message[]
  // The live DOM range to highlight/anchor to. null for restored sessions.
  range?: Range | null
  // Pre-existing Q&A to re-render (restored sessions)
  messages?: Message[]
  // Saved position/size. When present it overrides the beside-selection layout.
  geometry?: PanelGeometry | null
  // Start collapsed into the dock (restored sessions that were minimized)
  startMinimized?: boolean
  // A prompt to auto-send as soon as the panel opens (from a quick-action chip
  // like "Explain"). Empty/undefined just opens the panel for a free-form ask.
  initialPrompt?: string
  // For image sessions: the picture to send to the vision API, plus the original
  // src to show as a thumbnail in the panel.
  image?: ImageSource
  imagePreviewUrl?: string
  // How many panels are already open — cascades a new one so they don't stack
  cascadeIndex?: number
  // Called whenever the session's persistable state changes (messages, move,
  // resize, minimize) so the caller can save it
  onChange: (id: string) => void
  // Called when the panel closes itself
  onDestroy: (id: string) => void
}

// The one function you call to create and mount a panel
export const createPanel = (options: CreatePanelOptions): Panel => {
  const {
    id,
    text,
    config,
    seed,
    range = null,
    messages = [],
    geometry = null,
    startMinimized = false,
    initialPrompt = '',
    image,
    imagePreviewUrl,
    cascadeIndex = 0,
    onChange,
    onDestroy,
  } = options

  const notifyChange = (): void => onChange(id)

  // Build the preview text — truncate if too long
  const previewText =
    text.length > 200 ? escapeHtml(text.slice(0, 200)) + '…' : escapeHtml(text)

  // Build the panel DOM
  const panel = createPanelShell(previewText)
  document.body.appendChild(panel)

  // Pull out the sub-elements we need to interact with
  const messagesEl = panel.querySelector('.cir-messages') as HTMLDivElement
  const textarea = panel.querySelector('.cir-textarea') as HTMLTextAreaElement
  const sendBtn = panel.querySelector('.cir-send-btn') as HTMLButtonElement
  const closeBtn = panel.querySelector('.cir-close-btn') as HTMLButtonElement
  const header = panel.querySelector('.cir-panel-header') as HTMLElement
  const resizeHandles = Array.from(
    panel.querySelectorAll('.cir-resize-handle')
  ) as HTMLElement[]

  // Image sessions: swap the "Selected text" preview for a thumbnail and adapt
  // the input placeholder. The original src renders fine in an <img> regardless
  // of how the image is actually sent to the API (base64 or url).
  if (image && imagePreviewUrl) {
    const label = panel.querySelector('.cir-context-label') as HTMLElement
    const previewBox = panel.querySelector('.cir-context-text') as HTMLElement
    label.textContent = 'Image'
    previewBox.innerHTML = ''
    previewBox.classList.add('cir-context-has-image') // drop the 3-line text clamp
    const img = document.createElement('img')
    img.className = 'cir-context-img'
    img.src = imagePreviewUrl
    img.alt = 'Selected image'
    previewBox.appendChild(img)
    textarea.placeholder = 'Ask about this image…'
  }

  // The labelled pill the panel collapses into when minimized
  const description = image
    ? 'Image'
    : text.replace(/\s+/g, ' ').trim().slice(0, 160)
  const minimizedIcon = createMinimizedIcon(description)

  // Position: use saved geometry if restoring, else sit beside the selection
  if (geometry) {
    panel.style.left = `${geometry.left}px`
    panel.style.top = `${geometry.top}px`
    panel.style.width = `${geometry.width}px`
    panel.style.height = `${geometry.height}px`
    panel.style.right = 'auto'
    panel.style.maxHeight = 'none'
  } else {
    const offset = (cascadeIndex % 6) * 26
    const top = range ? calculatePanelTop(range) : window.scrollY + 80
    panel.style.top = `${top + offset}px`
    panel.style.right = `${16 + offset}px`
  }

  // Capture the panel's current geometry so we can persist size/position. While
  // minimized the panel is display:none (rect would be 0), so we keep the last
  // known geometry instead of reading a collapsed rect.
  let lastGeometry: PanelGeometry | null = geometry
  const captureGeometry = (): void => {
    const rect = panel.getBoundingClientRect()
    lastGeometry = {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    }
  }

  // Persist after a move or resize finishes
  const persistGeometry = (): void => {
    captureGeometry()
    notifyChange()
  }

  // Make the panel draggable by its header and resizable from its corners
  const stopDragging = makeDraggable(panel, header, persistGeometry)
  const stopResizing = makeResizable(panel, resizeHandles, persistGeometry)

  // Set up state
  const state = createInitialState()
  state.seed = [...seed]
  state.messages = [...messages]
  // Highlight only makes sense for live selections, not restored sessions
  if (range) state.highlightMark = applyHighlight(range)

  // Re-render any pre-existing Q&A (restored sessions)
  state.messages.forEach((m) =>
    messagesEl.appendChild(createMessageElement(m.role, m.content))
  )
  if (state.messages.length > 0) scrollMessagesToBottom(messagesEl)

  // ── Minimize / expand ─────────────────────────────────────────────────────
  // Clicking outside collapses the panel to a labelled pill (state is kept, the
  // panel is just hidden). Clicking the pill brings it back.

  let isMinimized = false

  function minimize(): void {
    if (isMinimized) return
    captureGeometry() // remember where it was before hiding
    isMinimized = true

    // Drop the pill into the shared dock — flexbox stacks it alongside any
    // other minimized sessions
    getDock().appendChild(minimizedIcon)
    minimizedIcon.classList.add('cir-minimized--visible')
    panel.style.display = 'none'
    notifyChange()
  }

  function expand(): void {
    if (!isMinimized) return
    isMinimized = false
    minimizedIcon.classList.remove('cir-minimized--visible')
    minimizedIcon.remove() // take it back out of the dock
    panel.style.display = 'flex'
    textarea.focus()
    notifyChange()
  }

  minimizedIcon.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    expand()
  })

  // ── Event listeners ──────────────────────────────────────────────────────

  closeBtn.addEventListener('click', destroy)

  const send = (): Promise<void> =>
    handleSend(state, config, text, image, messagesEl, textarea, sendBtn, notifyChange)

  sendBtn.addEventListener('click', send)

  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    // Enter sends, Shift+Enter adds a new line
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  })

  textarea.addEventListener('input', () => autoGrowTextarea(textarea))

  // Restored-but-minimized sessions start collapsed; otherwise focus the input
  if (startMinimized) {
    minimize()
  } else {
    setTimeout(() => textarea.focus(), 80)
  }

  // Quick-action chips ("Explain", "Summarize", …) pass an initialPrompt — fire
  // it immediately so the user gets an answer without typing. Free-form "Ask"
  // passes no prompt, leaving the panel open and focused.
  if (initialPrompt.trim()) {
    textarea.value = initialPrompt
    void send()
  }

  // ── Destroy ──────────────────────────────────────────────────────────────

  function destroy(): void {
    stopDragging()  // detach drag listeners so they don't leak
    stopResizing()  // detach resize listeners
    minimizedIcon.remove()
    panel.classList.add('cir-panel-exit')
    setTimeout(() => {
      panel.remove()
      removeHighlight(state.highlightMark)
    }, 200) // matches the CSS exit animation duration
    onDestroy(id)
  }

  function serialize(): SavedSession {
    // Refresh geometry from the live rect unless the panel is hidden
    if (!isMinimized) captureGeometry()
    return {
      id,
      text,
      seed: state.seed,
      messages: state.messages,
      geometry: lastGeometry,
      minimized: isMinimized,
      ...(image ? { image, imagePreviewUrl } : {}),
    }
  }

  return {
    id,
    // Both the panel and its minimized pill count as "inside" so an outside
    // click can tell them apart from everything else on the page
    contains: (node: Node) => panel.contains(node) || minimizedIcon.contains(node),
    minimize,
    destroy,
    serialize,
  }
}