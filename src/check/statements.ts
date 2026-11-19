// Splits a cloud answer into statements that can be checked against the letter.
// Statements keep the key of the Markdown block they come from (paragraph or
// list item), so the answer view can put a mark beside that block.

import { parseMarkdown, type Inline } from '../lib/markdown'

export interface Statement {
  id: number
  /** "b3" for a paragraph, "b4.2" for the third item of a list. */
  key: string
  text: string
}

const inlineText = (parts: Inline[]) => parts.map((p) => p.text).join('').replace(/\s+/g, ' ').trim()

// Lines that are about the answer or the reader, not claims about the letter.
const BOILERPLATE = [
  /legal advice/i,
  /international student office|immigration attorney|qualified attorney|tenant rights|lawyer/i,
  /^(?:note to the reader|before you send)\b/i,
  /^(?:dear|sincerely|best regards|kind regards|regards|thank you|thanks)\b/i,
  /^subject\s*:/i,
  /^(?:hi|hello)\b/i,
]

/** Sentence boundaries, without cutting "U.S." or "No. 4" or "$1,450.00". */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  let start = 0
  const re = /([.!?])(\s+)(?=[A-Z0-9"“(¿¡])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(start, m.index - 4), m.index + 1)
    // Abbreviations and initials: "U.S.", "No.", "Mr.", "e.g."
    if (/(?:\b[A-Z]\.|\b(?:No|Mr|Ms|Mrs|Dr|St|Apt|Inc|vs|e\.g|i\.e)\.)$/.test(before)) continue
    out.push(text.slice(start, m.index + 1).trim())
    start = m.index + 1 + m[2].length
  }
  const rest = text.slice(start).trim()
  if (rest) out.push(rest)
  return out.filter(Boolean)
}

const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

export function isCheckable(sentence: string): boolean {
  const bare = sentence.replace(/⟦[A-Z_]+_\d+⟧/g, ' ')
  if (wordCount(bare) < 4) return false
  // A sign-off or contact block: mostly hidden details and their labels.
  if ((sentence.match(/⟦[A-Z_]+_\d+⟧/g) ?? []).length >= 2 && wordCount(bare) < 6) return false
  // Questions (in a draft reply) and statements about what the letter leaves
  // out make no claim a passage of the letter could support.
  if (/\?\s*$/.test(sentence)) return false
  if (/\b(?:the letter|it|this notice|the notice)\s+(?:does not|doesn't|did not|never)\s+(?:say|state|mention|specify|explain|list|include|tell)/i.test(sentence)) return false
  if (/\b(?:la carta|el aviso)\s+no\s+(?:dice|menciona|indica|especifica)/i.test(sentence)) return false
  if (BOILERPLATE.some((re) => re.test(sentence))) return false
  // A sentence with a gap the reader has to fill in, such as "[describe the document]".
  if (/\[[a-z][^\]]*\]/i.test(sentence)) return false
  return true
}

/** Checkable statements of a Markdown answer, in reading order. */
export function splitStatements(markdown: string): Statement[] {
  const out: Statement[] = []
  parseMarkdown(markdown).forEach((block, i) => {
    const units: { key: string; text: string }[] = []
    if (block.type === 'paragraph') units.push({ key: `b${i}`, text: inlineText(block.inline) })
    else if (block.type === 'list') block.items.forEach((item, j) => units.push({ key: `b${i}.${j}`, text: inlineText(item.inline) }))
    for (const u of units) {
      for (const s of splitSentences(u.text)) if (isCheckable(s)) out.push({ id: out.length, key: u.key, text: s })
    }
  })
  return out
}
