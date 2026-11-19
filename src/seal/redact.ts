// Sealing: replaces sensitive spans with typed placeholders before any text is
// allowed to leave the device, and restores them locally afterwards.
// Everything in this file runs on the device. Nothing here touches the network.

import { resolveOverlaps, type Kind, type Span } from './detectors'

export const OPEN = '⟦' // ⟦
export const CLOSE = '⟧' // ⟧

export interface SealEntry {
  placeholder: string
  kind: Kind
  value: string
}

export interface Sealed {
  /** Text that is safe to show in the "what leaves this device" panel. */
  sealedText: string
  /** Placeholder to original value. Never sent anywhere. */
  entries: SealEntry[]
  /** The input after placeholder brackets were stripped; spans refer to this. */
  sourceText: string
}

/**
 * Removes the placeholder bracket characters from untrusted input so a crafted
 * letter cannot contain a ready-made placeholder that would later be swapped
 * for a real value. Spans must be computed on the returned text.
 */
export function sanitizeInput(text: string): string {
  return text.split(OPEN).join('[').split(CLOSE).join(']')
}

const key = (kind: Kind, value: string) => `${kind}\u0000${value.trim().toLowerCase()}`

/**
 * Replaces every span with a placeholder. The same value of the same kind
 * always gets the same placeholder, so text written about the sealed version
 * stays coherent and can be restored without ambiguity.
 */
export function seal(sourceText: string, spans: Span[]): Sealed {
  return sealWith(sourceText, spans, [])
}

const PLACEHOLDER_NUMBER = /_(\d+)⟧$/

/**
 * Like seal(), but reuses the placeholders in `existing` for values already
 * known (a follow-up question that repeats the A-number gets ⟦A_NUMBER_1⟧
 * again) and numbers new values after the existing ones. The returned entries
 * contain the existing entries first, then any new ones.
 */
export function sealWith(sourceText: string, spans: Span[], existing: SealEntry[]): Sealed {
  if (sourceText.includes(OPEN) || sourceText.includes(CLOSE)) {
    throw new Error('seal() needs sanitized input: call sanitizeInput() first and detect on its result')
  }
  const ordered = resolveOverlaps(spans)
  const byKey = new Map<string, SealEntry>()
  const counters = new Map<Kind, number>()
  for (const entry of existing) {
    byKey.set(key(entry.kind, entry.value), entry)
    const n = Number(PLACEHOLDER_NUMBER.exec(entry.placeholder)?.[1] ?? 0)
    counters.set(entry.kind, Math.max(counters.get(entry.kind) ?? 0, n))
  }
  const used: SealEntry[] = []
  let out = ''
  let cursor = 0
  for (const span of ordered) {
    if (span.start < cursor || span.end > sourceText.length) continue
    const value = sourceText.slice(span.start, span.end)
    const k = key(span.kind, value)
    let entry = byKey.get(k)
    if (!entry) {
      const n = (counters.get(span.kind) ?? 0) + 1
      counters.set(span.kind, n)
      entry = { placeholder: `${OPEN}${span.kind}_${n}${CLOSE}`, kind: span.kind, value }
      byKey.set(k, entry)
      used.push(entry)
    }
    out += sourceText.slice(cursor, span.start) + entry.placeholder
    cursor = span.end
  }
  out += sourceText.slice(cursor)
  return { sealedText: out, entries: [...existing, ...used], sourceText }
}

/** Puts original values back. Unknown placeholders are left as they are. */
export function rehydrate(text: string, entries: SealEntry[]): string {
  let out = text
  for (const entry of entries) out = out.split(entry.placeholder).join(entry.value)
  return out
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Short values are compared exactly only: squashing "CA" or "12" would match
// almost any text and block every send.
const MIN_SQUASHED = 6

export interface Leak {
  placeholder: string
  kind: Kind
  how: 'exact' | 'reformatted'
}

/**
 * Checks an outbound payload for original values that survived sealing.
 * Catches case changes and re-punctuated identifiers such as an SSN with its
 * dashes removed. The send path must refuse to send when this is non-empty.
 */
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/**
 * True when `needle` occurs in `haystack` without cutting through a word, so a
 * hidden name "State" does not match "United States" in Blackbar's instructions.
 */
function containsWhole(haystack: string, needle: string): boolean {
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    const cutsStart = isWordChar(needle[0]) && isWordChar(haystack[at - 1])
    const cutsEnd = isWordChar(needle[needle.length - 1]) && isWordChar(haystack[at + needle.length])
    if (!cutsStart && !cutsEnd) return true
    at = haystack.indexOf(needle, at + 1)
  }
  return false
}

export function leakCheck(outbound: string, entries: SealEntry[]): Leak[] {
  const lower = outbound.toLowerCase()
  const squashed = squash(outbound)
  const leaks: Leak[] = []
  for (const entry of entries) {
    const value = entry.value.trim()
    if (!value) continue
    if (containsWhole(lower, value.toLowerCase())) {
      leaks.push({ placeholder: entry.placeholder, kind: entry.kind, how: 'exact' })
      continue
    }
    const sq = squash(value)
    if (sq.length >= MIN_SQUASHED && squashed.includes(sq)) {
      leaks.push({ placeholder: entry.placeholder, kind: entry.kind, how: 'reformatted' })
    }
  }
  return leaks
}

/** Adds a span the reader selected by hand. */
export function addUserSpan(spans: Span[], sourceText: string, start: number, end: number, kind: Kind = 'OTHER'): Span[] {
  const s = Math.max(0, Math.min(start, end))
  const e = Math.min(sourceText.length, Math.max(start, end))
  if (e <= s) return spans
  const added: Span = { start: s, end: e, kind, text: sourceText.slice(s, e), source: 'user' }
  // A hand-made selection replaces anything it overlaps.
  const rest = spans.filter((x) => !(x.start < e && s < x.end))
  return [...rest, added].sort((a, b) => a.start - b.start)
}

/** Reveals a span the reader judged to be a false positive. */
export function removeSpan(spans: Span[], start: number): Span[] {
  return spans.filter((x) => x.start !== start)
}
