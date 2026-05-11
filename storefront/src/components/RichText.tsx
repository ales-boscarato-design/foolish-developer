'use client'

import { useState, useEffect } from 'react'

interface RichTextProps {
  content: unknown
}

interface TextNode {
  type: 'text'
  text: string
  bold?: boolean
  italic?: boolean
}

interface ParagraphNode {
  type: 'paragraph'
  children: TextNode[]
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderNode(node: TextNode): string {
  if (node.type !== 'text' || !node.text) return ''
  let text = escapeHtml(node.text)
  if (node.bold) text = `<strong>${text}</strong>`
  if (node.italic) text = `<em>${text}</em>`
  return text
}

function renderParagraph(node: ParagraphNode): string {
  const children = (node.children || []).map(renderNode).join('')
  return `<p>${children}</p>`
}

export function RichText({ content }: RichTextProps) {
  const [html, setHtml] = useState('')

  useEffect(() => {
    if (!content || typeof content !== 'object') {
      setHtml('')
      return
    }

    try {
      const doc = content as { root?: { children?: ParagraphNode[] } }
      if (!doc?.root?.children) {
        setHtml('')
        return
      }

      const htmlContent = doc.root.children.map((node) => {
        if (node.type === 'paragraph') {
          return renderParagraph(node as ParagraphNode)
        }
        return ''
      }).join('')

      setHtml(htmlContent)
    } catch {
      setHtml('')
    }
  }, [content])

  if (!html) return null

  return (
    <div
      className="mb-6"
      style={{ lineHeight: 1.7, fontSize: '0.9375rem' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}