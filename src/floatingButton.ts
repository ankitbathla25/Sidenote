import { QUICK_ACTIONS } from './actions'

// The only thing the outside world needs to know about the toolbar's position
export interface ButtonPosition {
  x: number
  y: number
}

// SVG for the primary "Ask" chip
const ASK_ICON = `
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>`

// Creates the floating toolbar: a row of one-click action chips plus the
// free-form "Ask" chip. Pure function, no side effects.
const createButtonElement = (): HTMLDivElement => {
  const bar = document.createElement('div')
  bar.className = 'cir-float-btn'
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Ask Claude about the selection')

  bar.innerHTML = QUICK_ACTIONS.map((action) => {
    const isAsk = action.id === 'ask'
    const cls = isAsk ? 'cir-float-action cir-float-ask' : 'cir-float-action'
    const icon = isAsk ? ASK_ICON : ''
    return `<button class="${cls}" data-action="${action.id}" type="button">${icon}<span>${action.label}</span></button>`
  }).join('')

  return bar
}

// Calculates where to place the toolbar based on the selection rectangle.
// Anchors to the selection's left edge, just above it. Horizontal overflow is
// clamped later in showButton(), once the element's real width is known.
export const calculateButtonPosition = (
  selectionRect: DOMRect
): ButtonPosition => {
  const BUTTON_HEIGHT = 38
  const GAP = 8 // pixels above the selection

  return {
    x: selectionRect.left + window.scrollX,
    y: selectionRect.top + window.scrollY - BUTTON_HEIGHT - GAP,
  }
}

// Moves the toolbar to a position and makes it visible, clamping its right edge
// to the viewport so the (now variable-width) chip row never runs off-screen.
const showButton = (btn: HTMLDivElement, position: ButtonPosition): void => {
  btn.classList.add('cir-float-btn--visible')

  const width = btn.offsetWidth || 260
  const maxLeft = window.scrollX + document.documentElement.clientWidth - width - 8
  const left = Math.max(window.scrollX + 8, Math.min(position.x, maxLeft))

  btn.style.left = `${left}px`
  btn.style.top = `${position.y}px`
}

// Hides the toolbar without removing it from the DOM
const hideButton = (btn: HTMLDivElement): void => {
  btn.classList.remove('cir-float-btn--visible')
}

// Everything the content script needs to interact with the toolbar
export interface FloatingButton {
  show: (position: ButtonPosition) => void
  hide: () => void
  contains: (node: Node) => boolean
  destroy: () => void
}

// The one function you call to create the floating toolbar. `onAction` is
// invoked with the clicked chip's action id (e.g. "ask", "explain").
export const createFloatingButton = (
  onAction: (actionId: string) => void
): FloatingButton => {
  const btn = createButtonElement()

  // One delegated handler for all chips. stopPropagation keeps the click from
  // bubbling to the document mousedown handler that would hide the toolbar.
  btn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    const chip = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null
    if (chip?.dataset.action) onAction(chip.dataset.action)
  })

  document.body.appendChild(btn)

  return {
    show: (position: ButtonPosition) => showButton(btn, position),
    hide: () => hideButton(btn),
    contains: (node: Node) => btn.contains(node),
    destroy: () => btn.remove(),
  }
}
