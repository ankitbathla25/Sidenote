// Represents one message in a conversation with Claude
export interface Message {
  role: 'user' | 'assistant'
  content: string
}

// What we store in chrome.storage.sync
export interface StorageData {
  claudeApiKey?: string
  claudeModel?: string
  // Whether to send the whole on-page (claude.ai) conversation as context.
  // Defaults to true when unset; turn off to send only the selected text and
  // cut the per-session token cost. Off-claude.ai pages have no conversation
  // to send, so this has no effect there.
  includePageContext?: boolean
}

// The text the user selected + the DOM range it came from.
// range is null for sessions restored after a page reload (the original
// selection no longer exists, so there's nothing to highlight or anchor to).
export interface SelectionContext {
  text: string
  range: Range | null
}

// Where a panel sits and how big it is, in absolute page coordinates
export interface PanelGeometry {
  left: number
  top: number
  width: number
  height: number
}

// A single inline session, serialized for persistence across page reloads
export interface SavedSession {
  id: string
  text: string            // the selected text the session is about
  seed: Message[]         // page conversation captured as context (not rendered)
  messages: Message[]     // the panel's own Q&A (rendered on restore)
  geometry: PanelGeometry | null
  minimized: boolean
}

// Token accounting Anthropic returns with every response. The two cache fields
// are what make prompt caching visible: `cache_read_input_tokens` is the slice
// of the prompt served from cache at ~10% price, `cache_creation_input_tokens`
// is what was written to the cache this turn.
export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

// Shape of a successful response from Anthropic's API
export interface AnthropicResponse {
  content: ContentBlock[]
  usage?: Usage
  error?: ApiError
}

// What sendMessage hands back: the reply text plus the turn's token usage
export interface ApiResult {
  text: string
  usage?: Usage
}

// A single block inside Anthropic's response
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
}

// Shape of an error from Anthropic's API
export interface ApiError {
  message: string
  type: string
}

// All the config needed to make a call — passed in explicitly, nothing hidden
export interface ApiConfig {
  apiKey: string
  model: string
}