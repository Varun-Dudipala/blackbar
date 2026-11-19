// Turns the device model's verdicts into checked statements. The model's quote
// is trusted only if it is found in the letter; otherwise the verdict is
// downgraded to "not in the letter".

import type { TokenResult } from './tokens'
import { bestWindow, coverage, letterSentences, sameNegation, words } from './passages'

/** supported: matched to a line of the letter; not_found: could not be matched; conflicts: a date, amount or reference differs (code only); not_compared: written in another language, so only numbers were compared. */
export type Verdict = 'supported' | 'not_found' | 'conflicts' | 'not_compared'

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

/**
 * When the model's quote is not word for word in the letter, looks for one or
 * two adjacent letter sentences that contain nearly all of its content words
 * (at least 85%, and 5 words or more). The quote shown is then the letter's
 * own text. Returns null when nothing is that close.
 */
export function recoverQuote(letter: string, quote: string): Quote | null {
  if (words(quote).length < 5) return null
  const m = bestWindow(quote, letter, letterSentences(letter), 2)
  if (!m || m.overlap < 0.85) return null
  return { text: m.text, start: m.start, end: m.end }
}

export interface RawVerdict {
  id: number
  verdict: string
  /** Up to two passages from the letter; each must be found in the letter to count. */
  quotes?: string[]
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
/**
 * A model "supported" counts only if its quote shares at least this share of
 * the statement's content words and agrees on negation. Chosen from the
 * measurement: without it the device model marked 6 to 8 of 27 invented
 * statements as matched.
 */
export const MODEL_QUOTE_COVERAGE = 0.6

export function settle(
  statement: { id: number; key: string; text: string },
  tokens: TokenResult[],
  close: Close | null,
  plainly: boolean,
  raw: RawVerdict | undefined,
  letter: string,
  /** The statement with hidden details restored, for comparing words with the quote. */
  realText: string = statement.text,
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
  const quote = raw ? firstVerified(letter, [...(raw.quotes ?? []), ...(raw.quote ? [raw.quote] : [])]) : null
  if (verdict === 'supported' && quote && coverage(realText, quote.text) >= MODEL_QUOTE_COVERAGE && sameNegation(realText, quote.text)) {
    return { ...base, verdict: 'supported', quote }
  }
  return base
}

/** The first of the model's quotes that is found in the letter (word for word, or closely as above). */
function firstVerified(letter: string, quotes: string[]): Quote | null {
  for (const q of quotes.slice(0, 2)) {
    const found = findQuote(letter, q) ?? recoverQuote(letter, q)
    if (found) return found
  }
  return null
}

/**
 * For an answer in another language: code still compares dates, amounts and
 * references, and can still flag them; the wording is not compared.
 */
export function settleOtherLanguage(statement: { id: number; key: string; text: string }, tokens: TokenResult[], close: Close | null): CheckedStatement {
  if (tokens.some((t) => !t.found)) return settle(statement, tokens, close, false, undefined, '')
  return { ...statement, tokens, verdict: 'not_compared' }
}

export interface CheckSummary {
  total: number
  supported: number
  notFound: number
  conflicts: number
  notCompared: number
}

export function summarise(statements: CheckedStatement[]): CheckSummary {
  const n = (v: Verdict) => statements.filter((s) => s.verdict === v).length
  return { total: statements.length, supported: n('supported'), notFound: n('not_found'), conflicts: n('conflicts'), notCompared: n('not_compared') }
}

/** The worst verdict among a block's statements, for its mark. */
export function blockVerdict(statements: CheckedStatement[]): Verdict | null {
  if (!statements.length) return null
  if (statements.some((s) => s.verdict === 'conflicts')) return 'conflicts'
  if (statements.some((s) => s.verdict === 'not_found')) return 'not_found'
  if (statements.some((s) => s.verdict === 'not_compared')) return 'not_compared'
  return 'supported'
}

export function summaryLine(s: CheckSummary, mode: 'model' | 'numbers' | 'other-language', languageName = 'another language'): string {
  if (s.total === 0) return 'Checked on this device: this answer has no statements about the letter to check.'
  const differs = s.conflicts ? ` ${s.conflicts} ${s.conflicts === 1 ? 'differs' : 'differ'} from the letter.` : ''
  if (mode === 'other-language') {
    const ok = s.total - s.conflicts - s.notFound
    const flagged = s.notFound ? ` ${s.notFound} ${s.notFound === 1 ? 'has a number' : 'have numbers'} the letter does not contain.` : ''
    return `Checked on this device: this answer is in ${languageName}, so its wording was not compared with the letter. Dates, amounts and references were compared in all ${s.total} statements; ${ok} ${ok === 1 ? 'matches' : 'match'} the letter.${differs}${flagged}`
  }
  const head = mode === 'model' ? 'Checked on this device' : 'Dates, amounts and numbers checked on this device'
  const unmatched = s.notFound ? ` ${s.notFound} could not be matched; read ${s.notFound === 1 ? 'it' : 'them'} against the letter yourself.` : ''
  return `${head}: ${s.supported} of ${s.total} ${s.total === 1 ? 'statement' : 'statements'} matched to lines in your letter.${differs}${unmatched}`
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
