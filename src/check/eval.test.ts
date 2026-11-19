// Measures the code part of the answer check on real Gemini answers (should be
// matched) and on invented statements (must not be). Run with EVAL=1 to print
// the grid used to choose the window size and threshold.
import { describe, expect, it } from 'vitest'
import { buildSamples } from '../letters/samples'
import { detect } from '../seal/detectors'
import { mapModelStrings } from '../seal/modelSpans'
import { rehydrate, seal } from '../seal/redact'
import { CAPTURED } from './fixtures.captured'
import { INVENTED } from './fixtures.invented'
import { splitStatements } from './statements'
import { bestWindow, letterSentences, plainlyInWindow } from './passages'
import { MATCH_THRESHOLD, MATCH_WINDOW } from './run'

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

const samples = Object.fromEntries(buildSamples({ year: 2026, month: 11, day: 19 }).map((s) => [s.id, s]))
const entriesFor = (id: string) => {
  const text = samples[id].text
  const spans = [...detect(text), ...mapModelStrings(text, samples[id].modelOnly.map((v) => ({ kind: 'NAME', value: v })))]
  return seal(text, spans).entries
}

const real = CAPTURED.filter((c) => c.language === 'en').flatMap((c) =>
  splitStatements(c.answer).map((s) => ({ letter: c.letter, text: rehydrate(s.text, entriesFor(c.letter)) })),
)
const invented = Object.entries(INVENTED).flatMap(([letter, list]) => list.map((text) => ({ letter, text })))

function rate(items: { letter: string; text: string }[], win: number, t: number) {
  let n = 0
  for (const it of items) {
    const letter = samples[it.letter].text
    const m = bestWindow(it.text, letter, letterSentences(letter), win)
    if (plainlyInWindow(it.text, m, t)) n++
  }
  return n
}

describe('answer check measurement', () => {
  it('has data', () => {
    expect(real.length).toBeGreaterThan(40)
    expect(invented.length).toBeGreaterThanOrEqual(24)
  })

  it('code alone matches no invented statement at the chosen settings', () => {
    expect(rate(invented, MATCH_WINDOW, MATCH_THRESHOLD)).toBe(0)
    expect(rate(real, MATCH_WINDOW, MATCH_THRESHOLD)).toBeGreaterThanOrEqual(25)
  })

  it.runIf(env.EVAL === '1')('prints the grid', () => {
    const rows: string[] = []
    for (const win of [1, 2, 3]) {
      for (const t of [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9]) {
        rows.push(`window ${win} threshold ${t.toFixed(2)}: real matched ${rate(real, win, t)}/${real.length}, invented matched ${rate(invented, win, t)}/${invented.length}`)
      }
    }
    console.log(rows.join('\n'))
  })
})

describe('answer check measurement details', () => {
  it.runIf(env.EVAL === '1')('prints the invented statements that pass and the real ones that fail', () => {
    for (const [name, items] of [['invented', invented], ['real', real]] as const) {
      for (const it of items) {
        const letter = samples[it.letter].text
        const m = bestWindow(it.text, letter, letterSentences(letter), 3)
        const pass = plainlyInWindow(it.text, m, 0.75)
        if ((name === 'invented') === pass) console.log(`${name} ${pass ? 'PASS' : 'fail'} ${m?.overlap.toFixed(2)} | ${it.text.slice(0, 110)} || ${m?.text.replace(/\s+/g, ' ').slice(0, 90)}`)
      }
    }
  })
})
