import type { Message, AnthropicResponse, ApiConfig, ApiResult, Usage } from './types'

const API_URL = 'https://api.anthropic.com/v1/messages'

export const DEFAULT_MODEL = 'claude-sonnet-4-6'

export const AVAILABLE_MODELS = [
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    description: 'Most capable — best for complex questions',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    description: 'Balanced — fast and smart (recommended)',
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    description: 'Fastest — great for simple questions',
  },
] as const



// Builds the headers — pure function, same input always gives same output
const buildHeaders = (apiKey: string): HeadersInit => ({
  'Content-Type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
})

// Parses an error response from Anthropic into a readable message
const parseError = async (response: Response): Promise<string> => {
  try {
    const data = await response.json() as AnthropicResponse
    return data.error?.message ?? `API error: ${response.status}`
  } catch {
    return `API error: ${response.status}`
  }
}

// The Anthropic Messages API has two hard rules: the first message must be
// from the user, and roles must strictly alternate. A conversation scraped
// from the page won't always satisfy them (it may open with an assistant
// message, or have consecutive same-role turns). This makes any message list
// safe to send by dropping leading assistant turns and merging consecutive
// same-role turns into one.
const normalizeMessages = (messages: Message[]): Message[] => {
  const cleaned = messages
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .filter((m) => m.content.length > 0)

  // Drop any leading assistant messages — the list must start with the user
  while (cleaned.length > 0 && cleaned[0].role === 'assistant') {
    cleaned.shift()
  }

  // Merge consecutive same-role messages so roles strictly alternate
  const merged: Message[] = []
  for (const message of cleaned) {
    const last = merged[merged.length - 1]
    if (last && last.role === message.role) {
      last.content += `\n\n${message.content}`
    } else {
      merged.push({ ...message })
    }
  }

  return merged
}

// A message whose content may carry a cache breakpoint. The Anthropic API
// accepts either a plain string or an array of content blocks for `content`;
// only blocks can hold a `cache_control` marker, so we promote just the one
// message we want to cache up to.
interface CacheableMessage {
  role: 'user' | 'assistant'
  content: string | Array<{
    type: 'text'
    text: string
    cache_control?: { type: 'ephemeral' }
  }>
}

// Marks the last message with a prompt-caching breakpoint.
//
// Caching is a *prefix* match and the request renders as system → messages, so
// a breakpoint on the final message tells the API to cache everything before
// it: the system prompt + the frozen page conversation (`seed`) + every prior
// Q&A turn. On the first call that prefix is written to the cache; on every
// follow-up it's re-read at ~10% of the input price instead of being
// re-tokenised in full. The big, static seed is the dominant cost on long
// claude.ai threads, and it sits at the front of the prefix, so it benefits
// the most — exactly the case we're optimising for.
//
// One breakpoint is enough: the cache grows incrementally as the conversation
// does (each turn re-reads the previous turn's prefix, then writes the new
// extension). Prefixes shorter than the model minimum (~2–4K tokens) simply
// won't cache — no error, and nothing worth caching is lost.
const withConversationCache = (messages: Message[]): CacheableMessage[] => {
  const out: CacheableMessage[] = messages.map((m) => ({ ...m }))
  const last = out[out.length - 1]
  if (last && typeof last.content === 'string') {
    last.content = [
      { type: 'text', text: last.content, cache_control: { type: 'ephemeral' } },
    ]
  }
  return out
}

// Pulls the JSON payload out of one SSE event block (the line starting "data:")
const parseSSEData = (eventBlock: string): Record<string, unknown> | null => {
  const dataLine = eventBlock.split('\n').find((l) => l.startsWith('data:'))
  if (!dataLine) return null
  const json = dataLine.slice(5).trim()
  if (!json || json === '[DONE]') return null
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

// The one function everything else calls — no class, no this, no hidden state.
//
// Streams the reply: `onText` is invoked with each text delta as it arrives, so
// the panel can render the answer live instead of waiting for the whole thing.
// Returns the assembled text plus token usage once the stream completes.
export const sendMessage = async (
  config: ApiConfig,
  systemPrompt: string,
  messages: Message[],
  onText: (chunk: string) => void,
  maxTokens: number = 4096
): Promise<ApiResult> => {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: buildHeaders(config.apiKey),
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: withConversationCache(normalizeMessages(messages)),
      stream: true,
    }),
  })

  if (!response.ok) {
    const message = await parseError(response)
    throw new Error(message)
  }
  if (!response.body) {
    throw new Error('No response stream received')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const usage: Usage = { input_tokens: 0, output_tokens: 0 }

  // Anthropic sends Server-Sent Events: blocks separated by a blank line, each
  // with a "data: {json}" line. We accumulate text_delta chunks and pull token
  // counts from message_start (input/cache) and message_delta (final output).
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? '' // keep the trailing, possibly-incomplete block

    for (const block of blocks) {
      const payload = parseSSEData(block)
      if (!payload) continue

      if (payload.type === 'message_start') {
        const u = (payload.message as { usage?: Usage } | undefined)?.usage
        if (u) {
          usage.input_tokens = u.input_tokens ?? 0
          usage.output_tokens = u.output_tokens ?? 0
          usage.cache_creation_input_tokens = u.cache_creation_input_tokens
          usage.cache_read_input_tokens = u.cache_read_input_tokens
        }
      } else if (payload.type === 'content_block_delta') {
        const delta = payload.delta as { type?: string; text?: string } | undefined
        if (delta?.type === 'text_delta' && delta.text) {
          text += delta.text
          onText(delta.text)
        }
      } else if (payload.type === 'message_delta') {
        const u = (payload as { usage?: { output_tokens?: number } }).usage
        if (u?.output_tokens != null) usage.output_tokens = u.output_tokens
      } else if (payload.type === 'error') {
        const msg = (payload.error as { message?: string } | undefined)?.message
        throw new Error(msg ?? 'Streaming error')
      }
    }
  }

  return { text, usage }
}