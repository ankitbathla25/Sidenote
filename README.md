# Sidenote

> Highlight text on **any web page**, ask Claude about it, and get the answer as
> a note right beside your selection — no tab-switching, no losing your place.

A Chrome (Manifest V3) extension that turns any selected text into an instant
Claude conversation. On **claude.ai** it also feeds the whole on-screen
conversation in as context, so answers know exactly what you were reading.

It uses **your own Anthropic API key** and talks to the API directly. It is not
connected to your claude.ai login or subscription — it's a separate, stateless
conversation billed to your API credits.

---

## Quick start

```bash
yarn install
yarn build           # outputs to dist/
```

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → select the `dist/` folder.
3. Click the extension icon and paste your Anthropic API key (`sk-ant-…`).
4. Highlight some text on any page and click **"Ask about this"**.

Use `yarn dev` for a watch build while developing.

---

## Features

### 1. Ask about any selection, inline
Highlight ≥ 5 characters of text and a small **floating toolbar** appears just
above the selection. Click **Ask** to type your own question, or a one-click
preset (**Explain**, **Summarize**, **Simplify**) to fire it instantly. A chat
panel opens beside the text and the answer **streams in live** — your reading
position never moves.

The exact text you selected is shown at the top of the panel and (on live
selections) highlighted on the page with a coral underline so you always know
what the conversation is about.

### 1a. One-click quick actions
The floating toolbar isn't just "Ask" — the **Explain / Summarize / Simplify**
chips send a tuned prompt about the selection the moment you click, so the common
cases need zero typing. (Defined in `src/actions.ts` — easy to add your own.)

### 1b. Live streaming answers
Replies render token-by-token as they arrive from the API instead of appearing
all at once after a pause, so long answers feel fast and you can start reading
immediately.

### 2. Follow-up conversations
Each panel is a full conversation, not a one-shot. Keep asking follow-ups and the
panel remembers the whole thread — every question and answer is replayed to
Claude on each turn, so it has full context. (Press **Enter** to send,
**Shift+Enter** for a newline.)

### 3. Multiple independent sessions
Every new selection opens its **own** panel with its **own** history. Open as
many as you like and run them side by side — asking about one passage doesn't
disturb another. New panels cascade slightly so they don't land exactly on top
of each other.

### 4. Full claude.ai conversation as context
On **claude.ai**, when you open a panel the extension reads the entire visible
conversation from the page and sends it to Claude as background context. That
means a question about one highlighted sentence is answered with awareness of the
whole chat — not just the snippet.

- The captured conversation is **sent but not shown** in the panel (it's already
  on the page).
- On any **other** site, there's no conversation to read, so it gracefully falls
  back to using just the highlighted text.

### 4a. Ask about images (vision)
**Right-click any image → "Ask Claude about this image"** to open a panel with
that picture attached and ask Claude's vision model about it — describe it, read
text from it, explain a chart or diagram, and so on. The image is fetched and
base64-encoded right in the page (so even private, logged-in-page images work);
if it can't be read locally, the public URL is handed to the API to fetch
server-side. A thumbnail of the image sits at the top of the panel.

### 5. Several ways to trigger
- **Floating toolbar** near a text selection (Ask + quick-action chips).
- **Right-click → "Ask Claude about '…'"** on selected text, or **"Ask Claude
  about this image"** on any image.
- **Keyboard shortcut:** `⌘/Ctrl + Shift + L` (rebindable at
  `chrome://extensions/shortcuts`).

They open a session from whatever you currently have selected (or the image you
right-clicked).

### 6. Draggable & resizable panels
- **Drag** a panel anywhere by grabbing its header.
- **Resize** from any of the **four corners** — each corner keeps the opposite
  edges anchored, so it grows toward the corner you pull (minimum size
  280 × 220).

### 7. Minimize to a labelled dock
Click **anywhere outside** the panels and they collapse into **pills** stacked in
a dock at the bottom-right of the screen — your sessions aren't lost, just tucked
away.

- Each pill shows a **short snippet** of the selected text so you can tell
  sessions apart.
- **Hover** a pill to see the fuller description in a tooltip.
- **Click** a pill to reopen that exact session.

### 8. Sessions survive page reloads
Open sessions are saved per-page (position, size, full conversation, and whether
they were minimized) and automatically **restored when you reload** the page.
Pick up exactly where you left off.

### 9. Model selection
Choose your model in the popup: **Claude Opus** (most capable), **Claude Sonnet**
(balanced, default), or **Claude Haiku** (fastest). The choice is saved and used
by every session.

### 10. Matches claude.ai's look
The UI uses Anthropic's ivory + coral palette and **inherits the page's fonts**
on-site so it feels native. It also follows your system **light/dark** preference
automatically.

### 11. Safe & self-contained
- User text is never rendered as raw HTML (it's escaped), so a selection can't
  inject markup into the panel.
- All injected elements are prefixed `cir-` and scoped, so the extension doesn't
  interfere with the host page.
- Nothing is sent anywhere except the Anthropic API, using your key.

---

## How a request is built

```
System prompt:  "…the user highlighted this passage: <selected text>…"
Messages:       [ …captured page conversation…,  …this panel's Q&A… ]
                          (seed, not shown)            (shown)
            └────────────────────────┬──────────────────────────┘
                       sent to api.anthropic.com/v1/messages
```

The message list is normalized before sending (must start with a user turn, roles
must alternate) so it's always valid for the Anthropic API.

---

## Settings

Open the toolbar popup to set:
- **Anthropic API key** — `sk-ant-…`, stored in `chrome.storage.sync`.
- **Model** — Opus / Sonnet / Haiku.

Changes are picked up live by any open page.

---

## Privacy

- Your selected text — and, on claude.ai, the visible conversation — is sent to
  **api.anthropic.com** using your API key. Nothing goes anywhere else.
- Your key and model live in `chrome.storage.sync`; open sessions live in
  `chrome.storage.local`. Both stay in your browser profile.
- The extension has **no access to and no connection with** your claude.ai
  account or subscription.

---

## Limitations

- **claude.ai in-app navigation:** session restore runs on page load, so
  switching chats without a full reload won't auto-reopen sessions.
- **DOM coupling:** conversation capture relies on claude.ai's current markup;
  if it changes, context falls back to the selection only.
- **Token cost:** long claude.ai threads still go to the API, but **prompt
  caching** means the conversation prefix (system prompt + captured thread +
  prior Q&A) is sent at full price only on the first turn and re-read at ~10%
  of the input price on every follow-up. Very short threads (under the model's
  ~2–4K-token cache minimum) aren't cached, but those are cheap anyway.

---

For architecture, the conversation model, the file-by-file guide, and
contribution notes, see [`CLAUDE.md`](./CLAUDE.md).
