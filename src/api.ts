import type { Message, AnthropicResponse, ContentBlock, ApiConfig, ApiResult } from './types'

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

// Extracts the text from Anthropic's response content blocks
const extractText = (blocks: ContentBlock[]): string => {
  const textBlock = blocks.find((block) => block.type === 'text')
  return textBlock?.text ?? ''
}

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

// The one function everything else calls — no class, no this, no hidden state
export const sendMessage = async (
  config: ApiConfig,
  systemPrompt: string,
  messages: Message[],
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
    }),
  })

  if (!response.ok) {
    const message = await parseError(response)
    throw new Error(message)
  }

  const data = await response.json() as AnthropicResponse
  return { text: extractText(data.content ?? []), usage: data.usage }
}