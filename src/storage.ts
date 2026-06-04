import type { SavedSession } from './types'

// ─── Session persistence ────────────────────────────────────────────────────────
// Open sessions are saved to chrome.storage.local keyed by the current page so
// they survive a reload. We key by origin + pathname (ignoring query/hash) so a
// claude.ai conversation restores its own sessions and nothing else's.

const STORAGE_KEY = 'cir-sessions'

const pageKey = (): string => location.origin + location.pathname

type SessionMap = Record<string, SavedSession[]>

// Once the extension is reloaded/updated, content scripts already injected into
// open tabs are "orphaned": their `chrome.*` calls throw "Extension context
// invalidated". `chrome.runtime.id` goes undefined in that state, so we check it
// before touching storage and bail out quietly — no uncaught promise rejections
// spamming the host page's console, and the (now-defunct) tab just no-ops until
// it's refreshed.
const extensionAlive = (): boolean => {
  try {
    return Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}

const readMap = async (): Promise<SessionMap> => {
  if (!extensionAlive()) return {}
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY)
    return (stored[STORAGE_KEY] as SessionMap | undefined) ?? {}
  } catch {
    return {}
  }
}

// Load the sessions saved for the current page
export const loadSessions = async (): Promise<SavedSession[]> => {
  const map = await readMap()
  return map[pageKey()] ?? []
}

// Replace the saved sessions for the current page. An empty list clears the
// page's entry entirely so storage doesn't accumulate stale keys. Never throws —
// storage/permission/context-invalidation failures fail quietly.
export const saveSessions = async (sessions: SavedSession[]): Promise<void> => {
  if (!extensionAlive()) return
  try {
    const map = await readMap()
    if (sessions.length === 0) {
      delete map[pageKey()]
    } else {
      map[pageKey()] = sessions
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: map })
  } catch {
    // orphaned content script or storage error — nothing we can do, fail quietly
  }
}
