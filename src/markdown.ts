// Escapes special HTML characters so raw text can't break the DOM
// e.g. if Claude says "use <div>" we don't want an actual div rendered
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

// Wraps consecutive list item lines into a <ul> block
const wrapListItems = (html: string): string =>
  html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')

// Converts fenced code blocks  ```lang\ncode\n```  into <pre><code>
const parseCodeBlocks = (html: string): string =>
  html.replace(
    /```[\w]*\n?([\s\S]*?)```/g,
    '<pre><code>$1</code></pre>'
  )

// Converts `inline code` into <code>
const parseInlineCode = (html: string): string =>
  html.replace(/`([^`\n]+)`/g, '<code>$1</code>')

// Converts **bold** into <strong>
const parseBold = (html: string): string =>
  html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

// Converts *italic* into <em>
const parseItalic = (html: string): string =>
  html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')

// Converts ### heading into <h3>, ## into <h2>, # into <h1>
// Order matters — do h3 first so ## doesn't match inside ###
const parseHeadings = (html: string): string =>
  html
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')

// Converts - item or * item lines into <li> elements
const parseListItems = (html: string): string =>
  html.replace(/^[-*] (.+)$/gm, '<li>$1</li>')

// Converts double newlines into paragraph breaks
const parseParagraphs = (html: string): string =>
  html.replace(/\n\n+/g, '</p><p>')

// Converts single newlines into <br> — only between non-tag characters
const parseLineBreaks = (html: string): string =>
  html.replace(/([^>])\n([^<])/g, '$1<br>$2')

// Wraps the whole thing in a <p> if it doesn't already start with a block element
const wrapInParagraph = (html: string): string =>
  /^<[hup]/.test(html.trimStart()) ? html : `<p>${html}</p>`

// ---
// The main render function — pipes the raw markdown string through
// each transformation in the correct order
// ---
export const renderMarkdown = (raw: string): string => {
  const pipeline: Array<(s: string) => string> = [
    escapeHtml,       // 1. escape HTML entities first — everything after this is safe
    parseCodeBlocks,  // 2. code blocks before inline code so backticks inside ``` aren't touched
    parseInlineCode,  // 3. inline code before bold/italic so *text* inside code isn't touched
    parseBold,        // 4. bold before italic so **text** isn't partially matched
    parseItalic,      // 5. italic
    parseHeadings,    // 6. headings
    parseListItems,   // 7. list items first — just <li> tags so far
    wrapListItems,    // 8. then wrap consecutive <li> tags in <ul>
    parseParagraphs,  // 9. double newlines → paragraph breaks
    parseLineBreaks,  // 10. single newlines → <br>
    wrapInParagraph,  // 11. wrap the whole thing in <p> if needed
  ]

  return pipeline.reduce((text, transform) => transform(text), raw)
}