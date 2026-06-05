# Sidenote

A Chrome (Manifest V3) browser extension. Highlight text **on any web page**, ask
Claude about it, and get the answer as a note right beside your selection — no
tab-switching, no losing your place. On **claude.ai** it also pulls the whole
on-screen conversation in as context.

---

## What it does

- **Select → ask → answer, inline.** Highlight any text; a floating toolbar of
  quick-action chips appears. Click **Ask** for a free-form question, or a preset
  (**Explain / Summarize / Simplify**) to fire it instantly. A small chat panel
  opens next to the selection and the answer **streams in live**, Markdown-rendered.
- **Ask about images (vision).** Right-click any image → *"Ask Claude about this
  image"* opens a panel with the picture attached and asks Claude's vision model
  about it. Images are fetched + base64-encoded in the page (covers private/
  same-origin images), falling back to a URL the API fetches server-side.
- **Summarize the whole page.** Right-click → *"Summarize this page with Claude"*
  scrapes the visible page text (capped) and auto-summarizes it.
- **Prompt library (`/` menu).** Typing `/` in a panel's input opens a filterable
  list of prompts — built-in ones (`BUILTIN_PROMPTS`) plus the user's own custom
  prompts (managed in the popup); pick one to auto-send it.
- **Follow-up conversations.** Each panel is a real conversation — keep asking
  follow-ups and the panel remembers the thread.
- **Multiple sessions at once.** Every selection opens its own independent
  panel. Run several side by side; each has its own history.
- **Full claude.ai context.** On claude.ai, the panel sends the entire visible
  conversation to Claude so answers are grounded in what you were reading. On
  other sites it falls back to just the highlighted text.
- **Movable, resizable, minimizable.** Drag a panel by its header, resize it
  from any corner, or click outside to collapse it into a labelled pill in a
  dock. Hover the pill to see what the session was about; click to reopen.
- **Survives reloads.** Open sessions (position, size, conversation, minimized
  state) are saved per-page and restored when you reload.
- **Several ways to trigger:** the floating toolbar, a right-click menu item
  (text *or* image), or a keyboard shortcut (`⌘/Ctrl + Shift + L`).
- **Looks like claude.ai.** Uses Anthropic's ivory + coral palette, inherits
  the page's fonts on-site, and follows light/dark mode automatically.

It talks to the **Anthropic API directly** using *your own* API key (stored in
`chrome.storage.sync`). It is **not** connected to your claude.ai login or
subscription — it's a separate, stateless API conversation billed to your API
credits.

---

## How it works (architecture)

The extension has three runtime contexts, plus shared modules:

```
┌─────────────────────┐     message      ┌──────────────────────┐
│  background.ts       │ ───────────────▶ │  content.ts          │
│  (service worker)    │  cir-ask-        │  (injected on every  │
│  • context menu      │   selection      │   http/https page)   │
│  • keyboard command  │                  │  • selection detect  │
└─────────────────────┘                  │  • session manager   │
                                          │  • persistence       │
┌─────────────────────┐                  └──────────┬───────────┘
│  popup.html/.ts      │                             │ creates
│  (toolbar settings)  │   chrome.storage.sync       ▼
│  • API key + model   │ ◀───────────────▶  ┌──────────────────┐
└─────────────────────┘                     │  panel.ts        │
                                             │  one per session │
                                             │  → api.ts        │
                                             └──────────────────┘
```

### The flow, step by step

1. **Selection** — `content.ts` listens for `mouseup`, reads the selection, and
   (unless it's inside the extension's own UI) shows the floating toolbar via
   `floatingButton.ts` — a row of quick-action chips (Ask / Explain / Summarize /
   Simplify) defined in `actions.ts`.
2. **Trigger** — clicking a chip calls `openPanelFromContext()`. The plain
   **Ask** chip (and the right-click menu / shortcut routed through
   `background.ts`) opens a free-form panel; the other chips pass a preset
   `initialPrompt` that the panel auto-sends on open.
3. **Context capture** — `scrapeConversation()` reads claude.ai's message
   elements (`[data-testid="user-message"]` for user turns,
   `.font-claude-response` for assistant turns, with a legacy
   `[data-message-author-role]` fallback) to build the conversation as context.
   Off claude.ai this is empty.
4. **Panel** — `createPanel()` (in `panel.ts`) mounts the chat panel, seeded
   with that conversation and the selected text.
5. **Ask** — on send, `panel.ts` calls `sendMessage()` in `api.ts`, which POSTs
   to `https://api.anthropic.com/v1/messages` with your key and `stream: true`.
   The request body is `[...seed, ...panelQA]`; the selected text goes in the
   system prompt.
6. **Render** — `sendMessage()` parses the SSE stream and fires an `onText`
   callback for each token; `panel.ts` re-renders the growing reply live with the
   tiny Markdown converter in `markdown.ts`, so the answer types out in place.
7. **Persist** — after any change, `content.ts` debounce-saves all open sessions
   to `chrome.storage.local` (keyed by page URL) via `storage.ts`.

### Conversation model

Each panel keeps two separate lists (`panel.ts` → `PanelState`):

- **`seed`** — the page conversation captured as context. Sent to the API on
  every call, but **never rendered** in the panel (it's already on the page).
- **`messages`** — the panel's own Q&A. Both rendered *and* sent.

The API receives `[...seed, ...messages]`. `api.ts`'s `normalizeMessages()` then
makes that list valid for Anthropic (must start with a `user` turn, roles must
strictly alternate) by dropping leading assistant turns and merging consecutive
same-role turns.

---

## Context & session management

### A new session is created on every trigger
There is **no "continue the last panel" path**. All three entry points —
`onActionClick` (floating toolbar chips) and the `cir-ask-selection` message
listener (right-click / keyboard shortcut) — call `openPanelFromContext()`, which calls
`createPanel({ id: newId(), messages: [], seed: scrapeConversation() })`.

So **each selection opens a brand-new, independent session**; existing panels
stay open and unaffected. The only path that *doesn't* create fresh state is
`restoreSession()` on page load, which reuses the **saved** `id`, `seed`, and
`messages`.

### Where each session's context comes from
A session blends two sources, kept separate in `PanelState`:

| Source | What | Captured | Sent? | Shown? |
|--------|------|----------|-------|--------|
| `seed` | The claude.ai page conversation | **Once**, at session creation (`scrapeConversation()`) | yes | no |
| `messages` | This panel's own Q&A | Grows with each follow-up | yes | yes |

Every request is `system = <selected text>` + `messages = [...seed, ...messages]`.
The selected text rides in the **system prompt on every call**, so it's always in
context regardless of thread length.

### `seed` is a frozen snapshot
`scrapeConversation()` runs **only at open time**. A session's `seed` never
updates afterward:

- If the claude.ai conversation grows after a panel is open, that panel won't see
  the new messages — open a new session to include them.
- Panels opened at different times can hold different seeds.
- On reload, the **saved** seed is restored (not re-scraped), keeping the session
  consistent with what it originally captured.
- It's entirely **client-side** — there is no server session id. Continuity is
  just re-sending the two arrays each turn. This conversation is also completely
  separate from the user's claude.ai login/session.

---

## File guide

| File | Responsibility |
|------|----------------|
| `src/content.ts` | Injected into every page. Selection detection, the session list, opening/restoring panels, persistence, and the background-trigger listener. |
| `src/panel.ts` | A single inline session: DOM, drag, 4-corner resize, minimize→dock, send handler, and `serialize()` for persistence. Exports `createPanel()` and the `Panel` interface. |
| `src/floatingButton.ts` | The floating toolbar of quick-action chips shown near a selection; reports the clicked action via an `onAction(id)` callback. |
| `src/actions.ts` | Quick-action chip definitions (`QUICK_ACTIONS`), the `/`-menu prompt library (`BUILTIN_PROMPTS`), and `SUMMARIZE_PAGE_PROMPT`. Shared by the toolbar, panel, and `content.ts`. |
| `src/api.ts` | Anthropic API client. Streaming `sendMessage()` (SSE → `onText` chunks + usage), model list, `normalizeMessages()`, `withConversationCache()`. |
| `src/markdown.ts` | Minimal Markdown→HTML renderer (with HTML escaping). |
| `src/storage.ts` | Load/save sessions in `chrome.storage.local`, keyed by `origin + pathname`. |
| `src/background.ts` | Service worker: context-menu items (selection → `cir-ask-selection`, image → `cir-ask-image` with the `srcUrl`, page → `cir-summarize-page`) and keyboard command → message the active tab. |
| `src/popup.html` / `src/popup.ts` | Toolbar popup: enter API key, choose model. Writes to `chrome.storage.sync`. |
| `src/types.ts` | Shared types: `Message`, `SelectionContext`, `ApiConfig`, `PanelGeometry`, `SavedSession`, etc. |
| `src/content.css` | All injected UI styles. Theme tokens (`--cir-*`) with a `prefers-color-scheme: dark` block. |
| `src/vite-env.d.ts` | Ambient types for `*.css` imports and the `chrome` namespace. |
| `public/manifest.json` | MV3 manifest: permissions, content script, background worker, commands. |

### Key design choices

- **No framework, no classes.** Everything is plain functions returning plain
  objects (e.g. `createPanel` returns a `Panel` with `contains`/`minimize`/
  `destroy`/`serialize`). State is held in explicit objects and passed in.
- **Self-contained UI.** All injected elements are prefixed `cir-` and styles are
  scoped to those classes, so the extension doesn't fight the host page. On-page
  panels use `font-family: inherit` to match the site's type.
- **Graceful degradation.** DOM scraping returns `[]` rather than throwing if
  claude.ai's markup changes, and the panel falls back to selection-only context.

---

## Features in detail

### Panels (sessions)
- Created per selection; multiple can be open. New panels **cascade** so they
  don't stack exactly on top of each other.
- **Drag** by the header. **Resize** from any of the four corners (each anchors
  the opposite edges; min size 280×220). **Escape** closes the most recent
  panel; the **✕** closes a specific one.

### Minimize dock
- Clicking **outside** all panels collapses them into labelled **pills** in a
  fixed bottom-right dock (flexbox-stacked, newest nearest the corner).
- Each pill shows a short snippet of the selected text; **hovering** reveals the
  fuller description. Clicking a pill re-expands that session.

### Persistence
- Sessions are saved to `chrome.storage.local` under a per-page key and restored
  on reload — including position, size, conversation, and minimized state.
- Restored panels skip the selection highlight (the original DOM range is gone).

### Triggers
- **Floating button** near the selection.
- **Right-click → "Ask Claude about '…'"** (context-menu, via `background.ts`).
- **Keyboard:** `⌘/Ctrl + Shift + L` (configurable at `chrome://extensions/shortcuts`).

### Settings (popup)
- **API key** (`sk-ant-…`, validated for the right prefix), **model**
  (Opus / Sonnet / Haiku), a **"Send full page conversation as context"**
  toggle (`includePageContext`, default on), and **custom prompts**
  (`customPrompts`, surfaced in the panel's `/` menu). All stored in
  `chrome.storage.sync` and picked up live by open pages.

---

## Build & develop

This project uses **Yarn 4 (PnP)**, **TypeScript**, and **Vite 6** with
**`@crxjs/vite-plugin`** (which compiles the TS entry points and rewrites the
manifest).

> **Service-worker build note:** `vite.config.ts` adds an `inlineServiceWorker`
> plugin. `@crxjs` normally emits the worker as a loader that `import`s the
> background chunk as an ES module, which Chrome can refuse to register
> (*"Service worker registration failed. Status code: 2"* → no `onInstalled`, so
> context menus never get created). The plugin inlines the chunk into
> `service-worker-loader.js` so the worker is self-contained with no imports.
> Don't remove it, and keep Vite pinned to 6.x (the range `@crxjs` 2.4.0 is
> tested against).

```bash
yarn install        # install dependencies (required once)
yarn dev            # vite build --watch — rebuilds dist/ on change
yarn build          # one-off production build into dist/
yarn type-check     # tsc --noEmit
```

### Load the extension
1. `yarn build` (or `yarn dev` for watch mode).
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the `dist/` folder.
4. After changing the manifest, permissions, or the service worker, do a clean
   **Remove + Load unpacked** (and fully quit Chrome for service-worker changes)
   — the ↻ button doesn't reliably re-register a changed worker, and watch mode
   only rebuilds files.
5. **Refresh any open test tabs** — content scripts are only injected on page
   load, so after a reload the old script is orphaned ("Extension context
   invalidated") until you refresh. Note the floating chips are content-script
   only, so they can work even when the background/service worker is broken.
6. Open the popup and paste your Anthropic API key.

---

## Permissions & privacy

- **`storage`** — saves your API key/model (`sync`) and open sessions (`local`).
- **`contextMenus`** — the right-click entry.
- **`host_permissions: https://api.anthropic.com/*`** — to call the API.
- **Content script on `http/https://*/*`** — so you can select text anywhere.

Your selected text (and, on claude.ai, the visible conversation) is sent to the
Anthropic API using your key. Nothing is sent anywhere else. The extension has
no connection to your claude.ai account.

---

## Known limitations / things to watch

- **claude.ai SPA navigation:** session restore runs once when the content
  script loads. Switching chats in-app (no full reload) changes the page key, so
  sessions won't auto-reopen until an actual reload.
- **DOM coupling:** conversation scraping depends on claude.ai's per-turn
  markup (`[data-testid="user-message"]` / `.font-claude-response`); if that
  changes, context falls back to the selection only and a warning is logged to
  the page console.
- **Cross-origin API calls:** the request now fires from arbitrary sites; strict
  page CSPs could block it on some pages.
- **Cost:** on long claude.ai threads the whole conversation is sent each call.
  This is mitigated by **prompt caching** (`withConversationCache()` in
  `api.ts`): a `cache_control` breakpoint on the last message caches the whole
  prefix (system + `seed` + prior Q&A), so after the first turn it's re-read at
  ~10% of the input price instead of re-tokenised in full. Prefixes under the
  model's cache minimum (~2–4K tokens) silently don't cache. Two related
  controls also exist: a **context-scope toggle** in the popup
  (`includePageContext`) that sends only the selection instead of the whole
  thread, and a **per-turn usage line** under each reply (`createUsageElement`
  in `panel.ts`) that surfaces token counts and cache hits from the response's
  `usage`.
