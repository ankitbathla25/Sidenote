// The only thing the outside world needs to know about the button's position
export interface ButtonPosition {
  x: number
  y: number
}

// Creates the floating button DOM element — pure function, no side effects
const createButtonElement = (): HTMLDivElement => {
  const btn = document.createElement('div')
  btn.className = 'cir-float-btn'
  btn.setAttribute('role', 'button')
  btn.setAttribute('aria-label', 'Ask about selected text')
  btn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
    <span>Ask about this</span>
  `
  return btn
}

// Calculates where to place the button based on the selection rectangle
// Positions it just above the selection, right-aligned to it
export const calculateButtonPosition = (
  selectionRect: DOMRect
): ButtonPosition => {
  const BUTTON_WIDTH = 148
  const BUTTON_HEIGHT = 36
  const GAP = 8 // pixels above the selection

  const x = Math.max(
    selectionRect.right + window.scrollX - BUTTON_WIDTH,
    window.scrollX + GAP
  )

  const y = selectionRect.top + window.scrollY - BUTTON_HEIGHT - GAP

  return { x, y }
}

// Moves the button to a position and makes it visible
const showButton = (btn: HTMLDivElement, position: ButtonPosition): void => {
  btn.style.left = `${position.x}px`
  btn.style.top = `${position.y}px`
  btn.classList.add('cir-float-btn--visible')
}

// Hides the button without removing it from the DOM
// We reuse the same element rather than creating/destroying it repeatedly
const hideButton = (btn: HTMLDivElement): void => {
  btn.classList.remove('cir-float-btn--visible')
}

// Everything the content script needs to interact with the button
export interface FloatingButton {
  show: (position: ButtonPosition) => void
  hide: () => void
  contains: (node: Node) => boolean
  destroy: () => void
}

// The one function you call to create a floating button
// Returns a plain object with just the methods you need — no class, no this
export const createFloatingButton = (
  onClick: () => void
): FloatingButton => {
  const btn = createButtonElement()

  // Add click handler — stopPropagation so the click
  // doesn't bubble up and immediately trigger the document
  // mousedown handler that would hide the button
  btn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    onClick()
  })

  // Mount into the page once
  document.body.appendChild(btn)

  // Return a plain object — callers get exactly these four capabilities
  // and nothing else
  return {
    show: (position: ButtonPosition) => showButton(btn, position),
    hide: () => hideButton(btn),
    contains: (node: Node) => btn.contains(node),
    destroy: () => btn.remove(),
  }
}