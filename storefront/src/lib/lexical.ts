/**
 * Lightweight Lexical JSON → HTML converter for Payload CMS rich text.
 * Handles the common node types produced by Payload's lexical editor.
 */

export interface LexicalNode {
  type: string
  version?: number
  [key: string]: unknown
}

export interface LexicalTextNode extends LexicalNode {
  type: 'text'
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  code?: boolean
}

export interface LexicalParagraphNode extends LexicalNode {
  type: 'paragraph'
  children: LexicalNode[]
}

export interface LexicalLinebreakNode extends LexicalNode {
  type: 'linebreak'
}

export interface LexicalRoot extends LexicalNode {
  type: 'root'
  children: LexicalNode[]
  direction: 'ltr' | 'rtl' | null
}

export interface LexicalDocument {
  root: LexicalRoot
  [key: string]: unknown
}

type ConverterFn = (node: LexicalNode) => string

function nodeToHtml(node: LexicalNode, converters: Record<string, ConverterFn>): string {
  const converter = converters[node.type as string]
  if (converter) {
    return converter(node)
  }
  return ''
}

function textNodeToHtml(node: LexicalTextNode): string {
  let text = escapeHtml(node.text)
  if (node.bold) text = `<strong>${text}</strong>`
  if (node.italic) text = `<em>${text}</em>`
  if (node.underline) text = `<u>${text}</u>`
  if (node.strikethrough) text = `<s>${text}</s>`
  if (node.code) text = `<code>${text}</code>`
  return text
}

function paragraphToHtml(node: LexicalParagraphNode, converters: Record<string, ConverterFn>): string {
  const children = (node.children || []).map((child) => nodeToHtml(child, converters)).join('')
  return `<p>${children}</p>`
}

function linebreakToHtml(): string {
  return '<br>'
}

const converters = {
  text: textNodeToHtml as ConverterFn,
  paragraph: paragraphToHtml as ConverterFn,
  linebreak: linebreakToHtml as ConverterFn,
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function lexicalToHtml(doc: LexicalDocument): string {
  if (!doc?.root?.children) return ''

  const html = doc.root.children.map((node) => nodeToHtml(node, converters)).join('\n')
  return html
}

export function renderDescription(description: unknown): string {
  if (!description || typeof description !== 'object') return ''

  try {
    return lexicalToHtml(description as LexicalDocument)
  } catch {
    return ''
  }
}