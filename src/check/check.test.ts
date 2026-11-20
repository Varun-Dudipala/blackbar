import { describe, expect, it } from 'vitest'
import { buildSamples } from '../letters/samples'
import { isCheckable, splitSentences, splitStatements } from './statements'
import { checkTokens, extractTokens, indexLetter, normMoney } from './tokens'
import { selectPassages, splitPassages } from './passages'
import { blockVerdict, findQuote, numbersOnlyNote, settle, settleNumbersOnly, summarise, summaryLine } from './verdicts'
import { buildTestAnswer } from '../letters/testAnswers'
import { detect } from '../seal/detectors'
import { seal } from '../seal/redact'
import { batchItems, verdictPrompt } from './prompt'
import { checkAnswer, type Verifier } from './run'
import { estimateTokens } from '../lib/chunk'

const rfe = buildSamples({ year: 2026, month: 11, day: 18 })[0].text

describe('statement splitting', () => {
  it('keeps sentences whole across abbreviations and amounts', () => {
    expect(splitSentences('The U.S. Citizenship office wrote. Pay $1,450.00 by Friday. Then wait.')).toEqual([
      'The U.S. Citizenship office wrote.',
      'Pay $1,450.00 by Friday.',
      'Then wait.',
    ])
  })

  it('skips headings, greetings, referrals and short fragments, and keys statements by block', () => {
    const md = `### What it asks for\n\nUSCIS wants more documents for your OPT application. It was sent by the Potomac Service Center.\n\n- Send a copy of your Form I-20 endorsed by your DSO\n- Photos\n\nDear Sir or Madam,\n\nCheck anything about your immigration status with your school's international student office or a qualified immigration attorney.`
    const s = splitStatements(md)
    expect(s.map((x) => [x.key, x.text])).toEqual([
      ['b1', 'USCIS wants more documents for your OPT application.'],
      ['b1', 'It was sent by the Potomac Service Center.'],
      ['b2.0', 'Send a copy of your Form I-20 endorsed by your DSO'],
    ])
  })

  it('does not check sentences with gaps the reader must fill in', () => {
    expect(isCheckable('[describe the document you are attaching]')).toBe(false)
    expect(isCheckable('I am sending [describe the document you are attaching] today.')).toBe(false)
  })
})

describe('tokens', () => {
  it('normalises dates and amounts in the forms answers use', () => {
    const t = extractTokens('Respond by Dec. 15, 2026 or 12/15/2026. Pay $1,450 plus $75.00. Quote IOE0912345678 and Form I-765.')
    expect(t.filter((x) => x.kind === 'date').map((x) => x.norm)).toEqual(['2026-12-15', '2026-12-15'])
    expect(t.filter((x) => x.kind === 'amount').map((x) => x.norm)).toEqual(['1450.00', '75.00'])
    expect(t.filter((x) => x.kind === 'reference').map((x) => x.norm)).toEqual(['ioe0912345678', 'i765'])
    expect(normMoney('$ 1,286.00')).toBe('1286.00')
  })

  it('finds tokens that are in the letter and flags those that are not', () => {
    const idx = indexLetter(rfe)
    const ok = checkTokens('Your response must be received by December 15, 2026.', idx)
    expect(ok.map((t) => t.found)).toEqual([true])
    const bad = checkTokens('Send it by December 22, 2026 with a $85.00 fee and Form I-131.', idx)
    expect(bad.map((t) => [t.text, t.found])).toEqual([
      ['December 22, 2026', false],
      ['$85.00', false],
      ['I-131', false],
    ])
  })

  it('ignores years and ordinals', () => {
    expect(extractTokens('In 2026, the 3rd notice came.')).toEqual([])
  })
})

describe('passage selection', () => {
  const passages = splitPassages(rfe)

  it('covers the letter without overlaps', () => {
    for (let i = 1; i < passages.length; i++) expect(passages[i].start).toBeGreaterThanOrEqual(passages[i - 1].end)
    for (const p of passages) expect(rfe.slice(p.start, p.end).trim()).toBe(p.text)
  })

  it('picks the passage that shares the rare words of the statement', () => {
    const top = selectPassages('Send two passport-style photographs with your name written on the back.', passages, 1)
    expect(top[0].text).toMatch(/passport-style photographs/)
  })

  it('falls back to the opening passages when nothing overlaps', () => {
    expect(selectPassages('Hola mundo', passages, 2).map((p) => p.id)).toEqual([0, 1])
  })
})

describe('quote verification and verdicts', () => {
  it('finds a quote despite different line breaks, but not a reworded one', () => {
    const q = findQuote(rfe, 'Your response must be received by')
    expect(q && rfe.slice(q.start, q.end)).toBe('Your response must be received by')
    expect(findQuote('Please submit the\nfollowing:', 'Please submit the following:')).not.toBeNull()
    expect(findQuote(rfe, 'Your reply has to arrive by')).toBeNull()
    expect(findQuote(rfe, 'your response must be received by')).toBeNull()
    expect(findQuote(rfe, 'Dear')).toBeNull()
  })

  const st = { id: 0, key: 'b0', text: 'x' }

  const deadline = { text: 'Your response must be received by December 15, 2026.', start: 0, end: 10, overlap: 0.8 }

  it('downgrades a supported verdict whose quote is not in the letter', () => {
    const r = settle(st, [], null, false, { id: 0, verdict: 'supported', quote: 'a sentence the letter never had' }, rfe)
    expect(r.verdict).toBe('not_found')
  })

  it('keeps a supported verdict with a verified quote that covers the statement', () => {
    const passport = { ...st, text: 'Send a copy of the biographic page of your passport.' }
    const r = settle(passport, [], null, false, { id: 0, verdict: 'supported', quote: 'A copy of the biographic page of your passport.' }, rfe)
    expect(r.verdict).toBe('supported')
    expect(r.quote?.text).toBe('A copy of the biographic page of your passport.')
    // A real quote that shares little with the statement is not support.
    const other = settle({ ...st, text: 'USCIS is reviewing your application for a green card.' }, [], null, false, { id: 0, verdict: 'supported', quote: 'We are reviewing your Form I-765 for optional practical training.' }, rfe)
    expect(other.verdict).toBe('not_found')
    // Nor is one that negates what the statement says.
    const neg = settle({ ...st, text: 'You can register for spring classes while the hold is active.' }, [], null, false, { id: 0, verdict: 'supported', quote: 'While the hold is active you cannot register for spring classes' }, buildSamples({ year: 2026, month: 11, day: 18 })[2].text)
    expect(neg.verdict).toBe('not_found')
  })

  it('lets code, and only code, flag a statement', () => {
    const tokens = [{ kind: 'date' as const, text: 'December 22, 2026', norm: '2026-12-22', found: false }]
    // A wrong date in a statement that matches a letter sentence: it differs, and the sentence is shown.
    const c = settle(st, tokens, deadline, false, { id: 0, verdict: 'supported', quote: 'Your response must be received by' }, rfe)
    expect(c.verdict).toBe('conflicts')
    expect(c.quote?.text).toBe(deadline.text)
    expect(c.note).toBe('December 22, 2026 is not in the letter.')
    // A wrong date with no matching sentence: not found.
    expect(settle(st, tokens, { ...deadline, overlap: 0.2 }, false, undefined, rfe).verdict).toBe('not_found')
    // The model cannot flag: anything but a verified "supported" is just not found.
    expect(settle(st, [], null, false, { id: 0, verdict: 'conflicts', quote: 'Your response must be received by' }, rfe).verdict).toBe('not_found')
  })

  it('treats a statement code matched plainly as found, and a missing verdict as not found', () => {
    expect(settle(st, [], deadline, true, undefined, rfe).verdict).toBe('supported')
    expect(settle(st, [], null, false, undefined, rfe).verdict).toBe('not_found')
  })

  it('checks with code only when there is no device model', () => {
    expect(settleNumbersOnly(st, [], null, false)).toBeNull()
    expect(settleNumbersOnly(st, [{ kind: 'amount', text: '$5.00', norm: '5.00', found: true }], null, false)?.verdict).toBe('supported')
    expect(settleNumbersOnly(st, [], deadline, true)?.verdict).toBe('supported')
  })

  it('summarises plainly', () => {
    const s = summarise([
      { ...st, verdict: 'supported', tokens: [] },
      { ...st, verdict: 'supported', tokens: [] },
      { ...st, verdict: 'not_found', tokens: [] },
    ])
    expect(summaryLine(s, 'model')).toBe('Checked on this device: 2 of 3 statements matched to lines in your letter. 1 could not be matched; read it against the letter yourself.')
    expect(blockVerdict([{ ...st, verdict: 'supported', tokens: [] }, { ...st, verdict: 'conflicts', tokens: [] }])).toBe('conflicts')
  })
})

describe('batching', () => {
  it('keeps each request small', () => {
    const passages = splitPassages(rfe)
    const items = Array.from({ length: 15 }, (_, i) => ({ id: i, text: `Statement number ${i} about the passport photographs and the deadline.`, passages: selectPassages('passport photographs deadline', passages, 3) }))
    const batches = batchItems(items)
    expect(batches.flat()).toHaveLength(15)
    for (const b of batches) {
      expect(b.length).toBeLessThanOrEqual(6)
      expect(estimateTokens(verdictPrompt(b))).toBeLessThan(3000)
    }
  })
})

describe('checkAnswer', () => {
  const entries = [{ placeholder: '⟦A_NUMBER_1⟧', kind: 'A_NUMBER' as const, value: 'A123456789' }]
  const answer = `Your response must be received by December 22, 2026.\n\nYou must also pay an $85.00 processing fee.\n\nWrite ⟦A_NUMBER_1⟧ lightly on the back of the photographs.`

  it('flags a changed deadline and an invented fee even if the model calls them supported', async () => {
    const lazy: Verifier = async (prompt) => {
      const ids = [...prompt.matchAll(/STATEMENT (\d+):/g)].map((m) => Number(m[1]))
      return { text: JSON.stringify({ results: ids.map((id) => ({ id, verdict: 'supported', quote: 'Two passport-style photographs with your name and A-Number written lightly on the back.' })) }) }
    }
    const r = await checkAnswer(answer, entries, rfe, lazy, () => {}, new AbortController().signal)
    // The changed deadline matches the letter's deadline sentence, so it differs; the fee has no matching sentence.
    expect(r.statements.map((s) => s.verdict)).toEqual(['conflicts', 'not_found', 'supported'])
    // The statement keeps its placeholder for display; the A-number was still compared with the letter.
    expect(r.statements[2].text).toContain('⟦A_NUMBER_1⟧')
    expect(r.statements[2].tokens.map((t) => [t.text, t.found])).toEqual([['A123456789', true]])
  })

  it('shows the model hidden details as labels, never as values', async () => {
    let seen = ''
    const spy: Verifier = async (prompt) => {
      seen = prompt
      return { text: '{"results":[]}' }
    }
    await checkAnswer(answer, entries, rfe, spy, () => {}, new AbortController().signal)
    expect(seen).toContain('Write [A-number] lightly')
    expect(seen).not.toContain('⟦')
  })

  it('works without a model on numbers alone', async () => {
    const r = await checkAnswer(answer, entries, rfe, null, () => {}, new AbortController().signal)
    expect(r.mode).toBe('numbers')
    expect(r.statements.map((s) => s.verdict)).toEqual(['conflicts', 'not_found', 'supported'])
  })

  it('stops when cancelled', async () => {
    const c = new AbortController()
    c.abort()
    await expect(checkAnswer(answer, entries, rfe, async () => ({ text: '{}' }), () => {}, c.signal)).rejects.toThrow()
  })
})

describe('tuning from the measured runs', () => {
  it('does not check questions or statements about what the letter leaves out', () => {
    expect(isCheckable('Could you please confirm whether my waiver has been received?')).toBe(false)
    expect(isCheckable('The letter does not state whether the photographs can be uploaded.')).toBe(false)
  })

  it('recovers the letter sentence behind a slightly reworded quote, and nothing looser', async () => {
    const { recoverQuote } = await import('./verdicts')
    const q = recoverQuote(rfe, 'The evidence you submitted is not sufficient to establish eligibility')
    expect(q?.text).toBe('The evidence you submitted is not sufficient to establish eligibility.')
    expect(recoverQuote(rfe, 'The evidence you sent is fine and complete')).toBeNull()
  })
})

describe('settling by code', () => {
  it('matches a statement that repeats a letter sentence, but not a negated one', async () => {
    const { bestSentence, letterSentences, plainlyInLetter } = await import('./passages')
    const sentences = letterSentences(rfe)
    const yes = 'Send this notice with your response to the address above.'
    expect(plainlyInLetter(yes, bestSentence(yes, sentences))).toBe(true)
    const no = 'You do not need to send this notice with your response to the address above.'
    expect(plainlyInLetter(no, bestSentence(no, sentences))).toBe(false)
    const other = 'A letter from your employer confirming your job offer and salary.'
    expect(plainlyInLetter(other, bestSentence(other, sentences))).toBe(false)
  })

  it('asks the model only about statements code cannot settle', async () => {
    const prompts: string[] = []
    const v: Verifier = async (p) => {
      prompts.push(p)
      return { text: '{"results":[]}' }
    }
    const r = await checkAnswer('Send this notice with your response to the address above.\n\nA letter from your employer is required.', [], rfe, v, () => {}, new AbortController().signal)
    expect(r.statements.map((s) => s.verdict)).toEqual(['supported', 'not_found'])
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('employer')
    expect(prompts[0]).not.toContain('STATEMENT 0:')
  })
})

describe('second opinion', () => {
  it('asks each statement again when a whole batch comes back as not in the letter', async () => {
    const prompts: string[] = []
    const v: Verifier = async (p) => {
      prompts.push(p)
      const ids = [...p.matchAll(/STATEMENT (\d+):/g)].map((m) => Number(m[1]))
      const lone = ids.length === 1
      const quote = /biographic/.test(p) ? 'A copy of the biographic page of your passport.' : 'Two passport-style photographs with your name and A-Number written lightly on the back.'
      return { text: JSON.stringify({ results: ids.map((id) => ({ id, verdict: lone ? 'supported' : 'not_in_letter', quotes: lone ? [quote] : [] })) }) }
    }
    const r = await checkAnswer('Include a copy of the biographic page from your passport book.\n\nBring two passport-style photographs labelled with your name.', [], rfe, v, () => {}, new AbortController().signal)
    expect(prompts).toHaveLength(3)
    expect(r.calls).toBe(3)
    expect(r.statements.map((s) => s.verdict)).toEqual(['supported', 'supported'])
  })
})

describe('sign-off blocks', () => {
  it('does not check a block of hidden details and labels', () => {
    expect(isCheckable('⟦NAME_1⟧ Student ID: ⟦ACCOUNT_1⟧ SEVIS ID: ⟦SEVIS_1⟧')).toBe(false)
  })
})

describe('windows and other languages', () => {
  it('matches a statement against two adjacent sentences, and spells out acronyms', async () => {
    const { bestWindow, letterSentences, plainlyInWindow } = await import('./passages')
    const st = 'USCIS is reviewing your application for OPT and the evidence you submitted is not sufficient to establish eligibility.'
    const m = bestWindow(st, rfe, letterSentences(rfe), 2)
    expect(m?.text).toContain('We are reviewing your Form I-765 for optional practical training. The evidence you submitted')
    expect(plainlyInWindow(st, m, 0.7)).toBe(true)
  })

  it('does not compare the wording of an answer in another language, but still compares its numbers', async () => {
    const answer = 'Pague antes del December 23, 2026.\n\nReúna los documentos que pide la carta antes de enviarlos.'
    const r = await checkAnswer(answer, [], rfe, async () => ({ text: '{}' }), () => {}, new AbortController().signal, { language: 'es' })
    expect(r.mode).toBe('other-language')
    expect(r.calls).toBe(0)
    expect(r.statements.map((s) => s.verdict)).toEqual(['not_found', 'not_compared'])
    expect(summaryLine(summarise(r.statements), 'other-language', 'Spanish')).toBe(
      'Checked on this device: this answer is in Spanish, so its wording was not compared with the letter. Dates, amounts and references were compared in all 2 statements; 1 matches the letter. 1 has a number the letter does not contain.',
    )
  })
})

describe('the test answers without a device model', () => {
  const today = { year: 2026, month: 11, day: 18 }
  for (const sample of buildSamples(today)) {
    it(`flags the moved deadline and the invented fee, and counts what code could not check (${sample.id})`, async () => {
      const { text } = buildTestAnswer(sample.id, today)
      const sealed = seal(sample.text, detect(sample.text))
      const r = await checkAnswer(text, sealed.entries, sample.text, null, () => {}, new AbortController().signal)
      expect(r.mode).toBe('numbers')
      const flagged = r.statements.filter((s) => s.verdict === 'conflicts' || s.verdict === 'not_found')
      expect(flagged.length).toBeGreaterThanOrEqual(2)
      // The invented requirement has no date, amount or number, so code alone cannot judge it.
      expect(r.skipped).toBeGreaterThanOrEqual(1)
      expect(r.statements.length + (r.skipped ?? 0)).toBe(splitStatements(text).length)
    })
  }

  it('says how many statements were not checked', () => {
    expect(numbersOnlyNote(0)).toBe(" The wording was not checked, because Chrome's on-device model is not available.")
    expect(numbersOnlyNote(1)).toBe(" 1 statement has no date, amount or number to compare and was not checked, because Chrome's on-device model is not available.")
    expect(numbersOnlyNote(2)).toContain('2 statements have no date, amount or number to compare and were not checked')
  })
})
