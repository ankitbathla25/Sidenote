// ─── Background service worker ──────────────────────────────────────────────────
// Wires up the two ways to trigger the extension besides the floating button:
//   1. A right-click context menu on any selected text
//   2. A keyboard shortcut (configured in the manifest's "commands")
// Both just message the active tab's content script, which opens a session from
// the current selection.

const MENU_ID = 'cir-ask-selection'
const IMAGE_MENU_ID = 'cir-ask-image'

// Ask the content script in a tab to open a session from the current selection
const triggerAsk = (tabId: number): void => {
  chrome.tabs.sendMessage(tabId, { type: 'cir-ask-selection' }).catch(() => {
    // No content script on this tab (e.g. a chrome:// page) — ignore
  })
}

// Ask the content script to open a session about a right-clicked image
const triggerAskImage = (tabId: number, srcUrl: string): void => {
  chrome.tabs.sendMessage(tabId, { type: 'cir-ask-image', srcUrl }).catch(() => {
    // No content script on this tab — ignore
  })
}

// Create the context-menu items when the extension is installed/updated.
// removeAll() first so a reload (where the old items may still exist) doesn't
// throw a "duplicate id" error on the first create — which would abort before
// the rest of the menu items were registered.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Ask Claude about “%s”',
      contexts: ['selection'],
    })
    chrome.contextMenus.create({
      id: IMAGE_MENU_ID,
      title: 'Ask Claude about this image',
      contexts: ['image'],
    })
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id == null) return
  if (info.menuItemId === MENU_ID) {
    triggerAsk(tab.id)
  } else if (info.menuItemId === IMAGE_MENU_ID && info.srcUrl) {
    triggerAskImage(tab.id, info.srcUrl)
  }
})

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === MENU_ID && tab?.id != null) {
    triggerAsk(tab.id)
  }
})
