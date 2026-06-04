import type { SavedSession } from './types'

// ─── Session persistence ────────────────────────────────────────────────────────
// Open sessions are saved to chrome.storage.local keyed by the current page so
// they survive a reload. We key by origin + pathname (ignoring query/hash) so a
// claude.ai conversation restores its own sessions and nothing else's.

const STORAGE_KEY = 'cir-sessions'

const pageKey = (): string => location.origin + location.pathname

type SessionMap = Record<string, SavedSession[]>

const readMap = async (): Promise<SessionMap> => {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  return (stored[STORAGE_KEY] as SessionMap | undefined) ?? {}
}

// Load the sessions saved for the current page
export const loadSessions = async (): Promise<SavedSession[]> => {
  const map = await readMap()
  return map[pageKey()] ?? []
}

// Replace the saved sessions for the current page. An empty list clears the
// page's entry entirely so storage doesn't accumulate stale keys.
export const saveSessions = async (sessions: SavedSession[]): Promise<void> => {
  const map = await readMap()
  if (sessions.length === 0) {
    delete map[pageKey()]
  } else {
    map[pageKey()] = sessions
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: map })
}
