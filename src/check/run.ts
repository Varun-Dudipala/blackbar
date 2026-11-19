// Runs the answer check against the full letter, on the device only.
// 1. Code: dates, amounts and references must be in the letter; statements
//    that repeat a letter sentence nearly word for word are found.
// 2. The on-device model (if available) looks for support for the rest, with a
//    quote that must be found in the letter.
// Nothing here makes a network request.

import { rehydrate, type SealEntry } from '../seal/redact'
import { kindLabelOf } from '../seal/kinds'
import { parseModelJson } from '../ai/glance'
import { splitStatements } from './statements'
import { checkTokens, indexLetter } from './tokens'
import { bestSentence, letterSentences, plainlyInLetter, selectPassages, splitPassages } from './passages'
import { batchItems, verdictPrompt, VERDICT_SCHEMA, type CheckItem } from './prompt'
import { settle, settleNumbersOnly, type CheckedStatement, type RawVerdict } from './verdicts'

export interface CheckResult {
  mode: 'model' | 'numbers'
  statements: CheckedStatement[]
  /** Statements the model was asked about. */
  askedModel: number
  ms: number
  calls: number
}

export type Verifier = (prompt: string, schema: object, signal: AbortSignal) => Promise<{ text: string }>

/** "⟦A_NUMBER_1⟧" becomes "[A-number]", for the model's eyes only. */
export function labelPlaceholders(text: string): string {
  return text.replace(/⟦([A-Z_]+?)_\d+⟧/g, (_, kind: string) => `[${kindLabelOf(kind)}]`)
}

export async function checkAnswer(
  answer: string,
  entries: readonly SealEntry[],
  letter: string,
  verifier: Verifier | null,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
  now: () => number = () => performance.now(),
): Promise<CheckResult> {
  const t0 = now()
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  // Statements keep their placeholders so the answer view can show them with
  // bars; comparisons use the restored text, on the device.
  const statements = splitStatements(answer)
  const index = indexLetter(letter)
  const sentences = letterSentences(letter)
  const facts = new Map(
    statements.map((s) => {
      const real = rehydrate(s.text, [...entries])
      const close = bestSentence(real, sentences)
      return [s.id, { real, tokens: checkTokens(real, index), close, plainly: plainlyInLetter(real, close) }]
    }),
  )
  const f = (id: number) => facts.get(id)!

  if (!verifier) {
    const out = statements.map((s) => settleNumbersOnly(s, f(s.id).tokens, f(s.id).close, f(s.id).plainly)).filter((x): x is CheckedStatement => x !== null)
    return { mode: 'numbers', statements: out, askedModel: 0, ms: Math.round(now() - t0), calls: 0 }
  }

  // The model is asked only about statements code could not settle.
  const open = statements.filter((s) => f(s.id).tokens.every((t) => t.found) && !f(s.id).plainly)
  const passages = splitPassages(letter)
  const items: CheckItem[] = open.map((s) => ({ id: s.id, text: labelPlaceholders(s.text), passages: selectPassages(f(s.id).real, passages, 3, f(s.id).tokens.map((t) => (t.kind === 'reference' ? t.norm : t.kind === 'amount' ? t.norm.replace(/\.00$/, '') : ''))) }))
  const batches = items.length ? batchItems(items, 4) : []
  const raw = new Map<number, RawVerdict>()
  let calls = 0
  const ask = async (batch: CheckItem[]) => {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    calls++
    const { text } = await verifier(verdictPrompt(batch), VERDICT_SCHEMA, signal)
    const parsed = parseModelJson(text) as { results?: RawVerdict[] } | null
    return (parsed?.results ?? []).filter((r): r is RawVerdict => !!r && typeof r.id === 'number')
  }
  onProgress(0, batches.length)
  for (let i = 0; i < batches.length; i++) {
    for (const r of await ask(batches[i])) raw.set(r.id, r)
    // In testing the device model sometimes answered "not_in_letter" for every
    // statement of a batch, including plainly supported ones. When a whole
    // batch comes back that way, each statement is asked again on its own.
    const allAbsent = batches[i].length > 1 && batches[i].every((it) => raw.get(it.id)?.verdict !== 'supported')
    if (allAbsent) for (const it of batches[i]) for (const r of await ask([it])) raw.set(r.id, r)
    onProgress(i + 1, batches.length)
  }
  return {
    mode: 'model',
    statements: statements.map((s) => settle(s, f(s.id).tokens, f(s.id).close, f(s.id).plainly, raw.get(s.id), letter)),
    askedModel: open.length,
    ms: Math.round(now() - t0),
    calls,
  }
}
