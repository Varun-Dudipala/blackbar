// Turns the device model's verdicts into checked statements. The model's quote
// is trusted only if it is found in the letter; otherwise the verdict is
// downgraded to "not in the letter".

import type { TokenResult } from './tokens'

export type Verdict = 'supported' | 'not_found' | 'conflicts'

export interface Quote {
  text: string
  start: number
  end: number
}

export interface CheckedStatement {
  id: number
  key: string
  text: string
  verdict: Verdict
  quote?: Quote
  tokens: TokenResult[]
  /** Why the verdict differs from what the model said, if it does. */
  note?: string
}

const tidyQuote = (q: string) => q.trim().replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '').replace(/^\.\.\.|\.\.\.$|^…|…$/g, '').trim()

/**
 * Finds `quote` in the letter as written (letter case and punctuation must
 * match; runs of white space may differ, since a line break and a space read
 * the same). Returns offsets in the letter, or null.
 */
export function findQuote(letter: string, quote: string, minLength = 12): Quote | null {
  const q = tidyQuote(quote)
  if (q.length < minLength) return null
  const parts = q.split(/\s+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(parts.join('\\s+'))
  const m = re.exec(letter)
  if (!m) {
    // Allow a trailing full stop the letter does not have.
    if (/[.,;:]$/.test(q)) return findQuote(letter, q.slice(0, -1), minLength)
    return null
  }
  return { text: m[0], start: m.index, end: m.index + m[0].length }
}

const qwords = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/**
 * When the model's quote is not word for word in the letter, looks for the one
 * sentence or line of the letter that contains nearly all of its words (at
 * least 85%, and 5 words or more). The quote shown is then the letter's own
 * text. Returns null when no sentence is that close.
 */
export function recoverQuote(letter: string, quote: string): Quote | null {
  const want = qwords(quote)
  if (want.length < 5) return null
  const re = /[^\n.!?]+[.!?]?/g
  let best: { q: Quote; score: number } | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(letter)) !== null) {
    const have = new Set(qwords(m[0]))
    const hits = want.filter((w) => have.has(w)).length
    const score = hits / want.length
    if (score >= 0.85 && (!best || score > best.score)) {
      const lead = m[0].length - m[0].trimStart().length
      const text = m[0].trim()
      best = { q: { text, start: m.index + lead, end: m.index + lead + text.length }, score }
    }
  }
  return best?.q ?? null
}

export interface RawVerdict {
  id: number
  verdict: string
  quote?: string
}

// The model's verdict is used only to find support; it never flags a statement.
const asVerdict = (v: string): Verdict | null => (v.trim().toLowerCase() === 'supported' ? 'supported' : null)

interface Close {
  text: string
  start: number
  end: number
  overlap: number
}

const missingNote = (missing: TokenResult[]) => `${missing.map((t) => t.text).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in the letter.`

/**
 * Settles one statement. Code decides first, and only code can flag:
 * - a date, amount or reference that is not in the letter makes the statement
 *   "differs" when a letter sentence clearly covers the same point (that
 *   sentence is shown), and "not found" otherwise;
 * - a statement that repeats a letter sentence nearly word for word is found.
 * The device model is asked only about the rest, and only to find support: a
 * "supported" verdict counts if its quote is found in the letter. Everything
 * else is "not found", which means no line of the letter was matched to it.
 */
export function settle(
  statement: { id: number; key: string; text: string },
  tokens: TokenResult[],
  close: Close | null,
  plainly: boolean,
  raw: RawVerdict | undefined,
  letter: string,
): CheckedStatement {
  const base: CheckedStatement = { ...statement, verdict: 'not_found', tokens }
  const missing = tokens.filter((t) => !t.found)
  const closeQuote = close ? { text: close.text, start: close.start, end: close.end } : undefined
  if (missing.length) {
    if (close && close.overlap >= 0.5) return { ...base, verdict: 'conflicts', quote: closeQuote, note: missingNote(missing) }
    return { ...base, note: missingNote(missing) }
  }
  if (plainly && closeQuote) return { ...base, verdict: 'supported', quote: closeQuote }
  const verdict = raw ? asVerdict(raw.verdict) : null
  const quote = raw?.quote ? (findQuote(letter, raw.quote) ?? recoverQuote(letter, raw.quote)) : null
  if (verdict === 'supported' && quote) return { ...base, verdict: 'supported', quote }
  return base
}

export interface CheckSummary {
  total: number
  supported: number
  notFound: number
  conflicts: number
}

export function summarise(statements: CheckedStatement[]): CheckSummary {
  return {
    total: statements.length,
    supported: statements.filter((s) => s.verdict === 'supported').length,
    notFound: statements.filter((s) => s.verdict === 'not_found').length,
    conflicts: statements.filter((s) => s.verdict === 'conflicts').length,
  }
}

/** The worst verdict among a block's statements, for its mark. */
export function blockVerdict(statements: CheckedStatement[]): Verdict | null {
  if (!statements.length) return null
  if (statements.some((s) => s.verdict === 'conflicts')) return 'conflicts'
  if (statements.some((s) => s.verdict === 'not_found')) return 'not_found'
  return 'supported'
}

export function summaryLine(s: CheckSummary, mode: 'model' | 'numbers'): string {
  if (s.total === 0) return 'Checked on this device: this answer has no statements about the letter to check.'
  const parts = [`${s.supported} of ${s.total} ${s.total === 1 ? 'statement' : 'statements'} found in your letter`]
  if (s.notFound) parts.push(`${s.notFound} not found`)
  if (s.conflicts) parts.push(`${s.conflicts} ${s.conflicts === 1 ? 'differs' : 'differ'} from the letter`)
  const head = mode === 'model' ? 'Checked on this device' : 'Dates, amounts and numbers checked on this device'
  return `${head}: ${parts.join('. ')}.`
}

/**
 * Without the device model, code alone checks: dates, amounts and references,
 * and statements that repeat a letter sentence. Statements it cannot judge
 * are left out of the count.
 */
export function settleNumbersOnly(
  statement: { id: number; key: string; text: string },
  tokens: TokenResult[],
  close: Close | null,
  plainly: boolean,
): CheckedStatement | null {
  if (tokens.some((t) => !t.found) || (plainly && close)) return settle(statement, tokens, close, plainly, undefined, '')
  if (tokens.length) return { ...statement, tokens, verdict: 'supported', quote: close && close.overlap >= 0.5 ? { text: close.text, start: close.start, end: close.end } : undefined }
  return null
}

/** Checked statements grouped by the answer block they come from. */
export function byBlock(statements: readonly CheckedStatement[] | undefined): Map<string, CheckedStatement[]> {
  const map = new Map<string, CheckedStatement[]>()
  for (const s of statements ?? []) map.set(s.key, [...(map.get(s.key) ?? []), s])
  return map
}
