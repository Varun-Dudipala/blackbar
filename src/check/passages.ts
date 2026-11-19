// Picks the parts of the letter most likely to support a statement, by plain
// keyword overlap. No embeddings and no model.

export interface Passage {
  id: number
  start: number
  end: number
  text: string
}

const STOP = new Set(
  'a an and are as at be been but by can do does for from has have if in into is it its of on or our that the their them then there these this to was we were will with you your yours not no may must should would could please any all also only about which who what when where how than so such'.split(
    ' ',
  ),
)

export const words = (s: string) =>
  (s.toLowerCase().match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w))

/** Splits the letter into passages of about one to three lines or sentences. */
export function splitPassages(letter: string, target = 260): Passage[] {
  const out: Passage[] = []
  const pieces: { start: number; end: number }[] = []
  const re = /[^\n]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(letter)) !== null) {
    // Long lines are cut at sentence ends.
    const line = m[0]
    let s = 0
    const sent = /[.!?](?=\s+[A-Z0-9])/g
    let k: RegExpExecArray | null
    while ((k = sent.exec(line)) !== null) {
      pieces.push({ start: m.index + s, end: m.index + k.index + 1 })
      s = k.index + 1
    }
    pieces.push({ start: m.index + s, end: m.index + line.length })
  }
  let cur: { start: number; end: number } | null = null
  for (const p of pieces) {
    if (!letter.slice(p.start, p.end).trim()) continue
    if (cur && p.end - cur.start <= target) cur.end = p.end
    else {
      if (cur) out.push({ id: out.length, ...cur, text: letter.slice(cur.start, cur.end).trim() })
      cur = { ...p }
    }
  }
  if (cur) out.push({ id: out.length, ...cur, text: letter.slice(cur.start, cur.end).trim() })
  return out
}

/** The `k` passages sharing the most (rarity-weighted) words with the statement, in letter order. */
export function selectPassages(statement: string, passages: Passage[], k = 3, tokenNorms: readonly string[] = []): Passage[] {
  const df = new Map<string, number>()
  const sets = passages.map((p) => new Set(words(p.text)))
  for (const s of sets) for (const w of s) df.set(w, (df.get(w) ?? 0) + 1)
  const want = new Set(words(statement))
  const scored = passages.map((p, i) => {
    let score = 0
    for (const w of want) if (sets[i].has(w)) score += 1 / Math.log(2 + (df.get(w) ?? 0))
    // A passage that holds the statement's dates, amounts or references is very likely the one it is about.
    const flat = p.text.toLowerCase().replace(/[^a-z0-9.]/g, '')
    for (const t of tokenNorms) if (t && flat.includes(t)) score += 2
    return { p, score }
  })
  const best = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.p.id - b.p.id).slice(0, k)
  // Nothing in common (for example an answer in another language): fall back to the opening passages.
  const chosen = best.length ? best.map((x) => x.p) : passages.slice(0, k)
  return chosen.sort((a, b) => a.id - b.id)
}

export interface SentenceMatch {
  start: number
  end: number
  text: string
  /** Share of the statement's content words that the sentence contains (0 to 1). */
  overlap: number
}

const NEGATION = /\b(?:not|no|never|without|none|neither|nor|cannot|can't|don't|doesn't|isn't|aren't|won't)\b/i

/** Letter sentences (or lines), with offsets. */
export function letterSentences(letter: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = []
  const re = /[^\n.!?]+(?:[.!?](?!\d))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(letter)) !== null) {
    const text = m[0].trim()
    if (words(text).length < 2) continue
    const start = m.index + (m[0].length - m[0].trimStart().length)
    out.push({ start, end: start + text.length, text })
  }
  return out
}

/** The letter sentence that contains the largest share of the statement's content words. */
export function bestSentence(statement: string, sentences: { start: number; end: number; text: string }[]): SentenceMatch | null {
  const want = [...new Set(words(statement))]
  if (!want.length) return null
  let best: SentenceMatch | null = null
  for (const s of sentences) {
    const have = new Set(words(s.text))
    const overlap = want.filter((w) => have.has(w)).length / want.length
    if (!best || overlap > best.overlap) best = { ...s, overlap }
  }
  return best
}

/**
 * True when code alone can say a statement is in the letter: it repeats one
 * letter sentence nearly word for word (at least 75% of its content words,
 * and at least 4 of them), and neither side negates what the other says.
 */
export function plainlyInLetter(statement: string, match: SentenceMatch | null): boolean {
  if (!match || match.overlap < 0.75 || words(statement).length < 4) return false
  return NEGATION.test(statement) === NEGATION.test(match.text)
}

/** A light stemmer for overlap: "photographs" and "photograph", "reviewing" and "review" count as one word. */
export function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 4 && w.endsWith('es') && !w.endsWith('ses')) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

export const stems = (s: string) => words(s).map(stem)

/** Initials of a stretch of text ("optional practical training" gives "opt", "U.S. Citizenship" gives "usc"). */
export function initials(text: string): string {
  return text
    .split(/\s+/)
    .map((t) => (/^(?:[A-Za-z]\.){2,}$/.test(t) ? t.replace(/\./g, '') : t.replace(/[^\p{L}\p{N}]/gu, '').charAt(0)))
    .join('')
    .toLowerCase()
}

/** Acronyms written in capitals in the statement, such as "USCIS" or "OPT". */
const acronyms = (s: string) => [...new Set(s.match(/\b[A-Z]{2,6}\b/g) ?? [])].map((a) => a.toLowerCase())

/**
 * The run of one to `maxWindow` adjacent letter sentences that contains the
 * largest share of the statement's content words (after stemming). An acronym
 * in the statement counts as present when the window spells it out ("OPT" and
 * "optional practical training"). Ties go to the shorter window. The text
 * returned is the letter's own text.
 */
export function bestWindow(statement: string, letter: string, sentences: { start: number; end: number; text: string }[], maxWindow = 3): SentenceMatch | null {
  const acr = acronyms(statement)
  const want = [...new Set(stems(statement))]
  if (!want.length || !sentences.length) return null
  const sets = sentences.map((s) => new Set(stems(s.text)))
  let best: SentenceMatch | null = null
  for (let i = 0; i < sentences.length; i++) {
    const have = new Set<string>()
    for (let w = 0; w < maxWindow && i + w < sentences.length; w++) {
      for (const x of sets[i + w]) have.add(x)
      const start = sentences[i].start
      const end = sentences[i + w].end
      const text = letter.slice(start, end)
      const spelled = initials(text)
      const covered = want.filter((x) => have.has(x) || (acr.includes(x) && spelled.includes(x))).length
      const overlap = covered / want.length
      const better = !best || overlap > best.overlap + 1e-9 || (Math.abs(overlap - best.overlap) <= 1e-9 && end - start < best.end - best.start)
      if (better) best = { start, end, text, overlap }
    }
  }
  return best
}

/**
 * True when code alone can say a statement is in the letter: one to three
 * adjacent letter sentences hold at least `threshold` of its content words
 * (and at least 4 of them), and neither side negates what the other says.
 */
export function plainlyInWindow(statement: string, match: SentenceMatch | null, threshold: number): boolean {
  if (!match || match.overlap < threshold || words(statement).length < 4) return false
  const neg = /\b(?:not|no|never|without|none|neither|nor|cannot|can't|don't|doesn't|isn't|aren't|won't)\b/i
  return neg.test(statement) === neg.test(match.text)
}

/** Share of the statement's content words that `text` contains (stemmed; acronyms count when spelled out). */
export function coverage(statement: string, text: string): number {
  const want = [...new Set(stems(statement))]
  if (!want.length) return 0
  const have = new Set(stems(text))
  const acr = acronyms(statement)
  const spelled = initials(text)
  return want.filter((x) => have.has(x) || (acr.includes(x) && spelled.includes(x))).length / want.length
}

const NEG = /\b(?:not|no|never|without|none|neither|nor|cannot|can't|don't|doesn't|isn't|aren't|won't)\b/i
/** True when the statement and the text agree on whether something is negated. */
export const sameNegation = (a: string, b: string) => NEG.test(a) === NEG.test(b)
