// The deterministic half of the answer check: dates, amounts and reference-like
// tokens in a statement must appear in the letter. No model is involved.

import { findDates } from '../seal/detectors'
import { parseWrittenDate } from '../lib/deadlines'
import { toIso } from '../lib/dates'

export type TokenKind = 'date' | 'amount' | 'reference'

export interface Token {
  kind: TokenKind
  /** As written in the statement. */
  text: string
  /** Normalised form used for comparison. */
  norm: string
}

const MONEY = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\$\s?\d+(?:\.\d{2})?/g
// Reference-like: a run with at least one digit and at least one letter or a
// separator between digit groups, or a long plain number.
const REFERENCE = /\b(?=[A-Za-z0-9-]*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b|\b[A-Za-z]+\d[A-Za-z0-9]*\b|\b\d{5,}\b|\(\d{3}\)\s?\d{3}-\d{4}/g

export const normMoney = (s: string) => {
  const n = Number(s.replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n.toFixed(2) : s
}
export const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Dates, amounts and reference-like tokens stated in `text`. */
export function extractTokens(text: string): Token[] {
  const tokens: Token[] = []
  const taken: [number, number][] = []
  const free = (a: number, b: number) => !taken.some(([s, e]) => a < e && s < b)
  for (const d of findDates(text)) {
    const p = parseWrittenDate(d.text)
    if (!p) continue
    tokens.push({ kind: 'date', text: d.text, norm: toIso(p) })
    taken.push([d.start, d.end])
  }
  for (const m of text.matchAll(MONEY)) {
    const a = m.index ?? 0
    if (!free(a, a + m[0].length)) continue
    tokens.push({ kind: 'amount', text: m[0], norm: normMoney(m[0]) })
    taken.push([a, a + m[0].length])
  }
  for (const m of text.matchAll(REFERENCE)) {
    const a = m.index ?? 0
    const norm = squash(m[0])
    if (!free(a, a + m[0].length) || norm.length < 3) continue
    // Ordinals and plain years are not references.
    if (/^\d+(?:st|nd|rd|th)$/.test(norm) || /^(?:19|20)\d{2}$/.test(norm)) continue
    tokens.push({ kind: 'reference', text: m[0], norm })
    taken.push([a, a + m[0].length])
  }
  return tokens
}

export interface LetterIndex {
  dates: Set<string>
  amounts: Set<string>
  squashed: string
}

export function indexLetter(letter: string): LetterIndex {
  const dates = new Set<string>()
  for (const d of findDates(letter)) {
    const p = parseWrittenDate(d.text)
    if (p) dates.add(toIso(p))
  }
  const amounts = new Set([...letter.matchAll(MONEY)].map((m) => normMoney(m[0])))
  return { dates, amounts, squashed: squash(letter) }
}

export interface TokenResult extends Token {
  found: boolean
}

export function checkTokens(statement: string, index: LetterIndex): TokenResult[] {
  return extractTokens(statement).map((t) => ({
    ...t,
    found: t.kind === 'date' ? index.dates.has(t.norm) : t.kind === 'amount' ? index.amounts.has(t.norm) : index.squashed.includes(t.norm),
  }))
}
