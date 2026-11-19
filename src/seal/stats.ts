import { CLOSE, OPEN, type SealEntry } from './redact'

const PLACEHOLDER = new RegExp(`${OPEN}[A-Z_]+_\\d+${CLOSE}`, 'g')

/** Words as a reader would count them; a placeholder counts as one word. */
export function wordCount(text: string): number {
  const flat = text.replace(PLACEHOLDER, ' x ').trim()
  if (!flat) return 0
  return flat.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

export function placeholderCount(text: string): number {
  return text.match(PLACEHOLDER)?.length ?? 0
}

export interface OutboundStats {
  words: number
  /** Distinct identifiers hidden behind placeholders in this payload. */
  sealed: number
  /** Bars that appear in the payload, counting repeats. */
  bars: number
}

export function outboundStats(sealedText: string, entries: readonly SealEntry[]): OutboundStats {
  const present = entries.filter((e) => sealedText.includes(e.placeholder)).length
  return { words: wordCount(sealedText), sealed: present, bars: placeholderCount(sealedText) }
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/**
 * One wording for every count in the app. A "detail" is one distinct hidden
 * value (one placeholder); a "bar" is one place it is covered in the letter.
 * "11 details hidden (13 bars)", or "5 details hidden" when each appears once.
 */
export function hiddenSummary(details: number, bars: number): string {
  if (details === 0) return 'No details hidden'
  const head = `${plural(details, 'detail', 'details')} hidden`
  return bars === details ? head : `${head} (${plural(bars, 'bar', 'bars')})`
}

export const barCount = (bars: number) => plural(bars, 'bar', 'bars')
