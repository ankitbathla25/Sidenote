// ─── Background service worker ──────────────────────────────────────────────────
// Wires up the two ways to trigger the extension besides the floating button:
//   1. A right-click context menu on any selected text
//   2. A keyboard shortcut (configured in the manifest's "commands")
// Both just message the active tab's content script, which opens a session from
// the current selection.

const MENU_ID = 'cir-ask-selection'

// Ask the content script in a tab to open a session from the current selection
const triggerAsk = (tabId: number): void => {
  chrome.tabs.sendMessage(tabId, { type: 'cir-ask-selection' }).catch(() => {
    // No content script on this tab (e.g. a chrome:// page) — ignore
  })
}

// Create the context-menu item once, when the extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Ask Claude about “%s”',
    contexts: ['selection'],
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id != null) {
    triggerAsk(tab.id)
  }
})

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === MENU_ID && tab?.id != null) {
    triggerAsk(tab.id)
  }
})
