import { describe, expect, it, vi } from 'vitest'
import { detect } from '../seal/detectors'
import { seal } from '../seal/redact'
import { LeakBlockedError, buildPayload, gate, runCloud, type CloudSender } from './cloud'
import { classifyCloudError } from './cloudErrors'
import { normalizeGlance, parseModelJson, primaryDeadline } from './glance'
import { CLOUD_SYSTEM_INSTRUCTION, LANGUAGES, asksForLegalJudgment, buildCloudPrompt, findSensitivePrompt, glancePrompt, referralFor, touchesImmigration } from './prompts'

// Synthetic values only.
const LETTER = 'A-Number: A123456789. SSN: 000-12-3456. Respond by December 15, 2026. Pay $75.00.'
const sealed = seal(LETTER, detect(LETTER))

const fakeSender = (answer: string[]): CloudSender =>
  vi.fn(async () => ({
    origin: 'real' as const,
    chunks: (async function* () {
      yield* answer
    })(),
    done: Promise.resolve({ inferenceSource: 'in_cloud' }),
  }))

describe('leak gate', () => {
  it('passes a payload built from sealed text', () => {
    const payload = buildPayload({ task: 'explain', sealedLetter: sealed.sealedText, language: 'en' })
    expect(gate(payload, sealed.entries)).toEqual([])
  })

  it('refuses to call the sender when an identifier leaked, and names it', async () => {
    const sender = fakeSender(['never'])
    const payload = buildPayload({ task: 'followup', sealedLetter: sealed.sealedText, language: 'en', question: 'Is 000123456 my number?' })
    const err = await runCloud(payload, sealed.entries, sender, () => {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LeakBlockedError)
    expect((err as LeakBlockedError).leaks.map((l) => l.kind)).toEqual(['SSN'])
    expect(sender).not.toHaveBeenCalled()
  })

  it('refuses the raw letter outright', async () => {
    const sender = fakeSender(['never'])
    const payload = buildPayload({ task: 'explain', sealedLetter: LETTER, language: 'en' })
    await expect(runCloud(payload, sealed.entries, sender, () => {})).rejects.toBeInstanceOf(LeakBlockedError)
    expect(sender).not.toHaveBeenCalled()
  })

  it('streams the answer and reports the side that answered', async () => {
    const seen: string[] = []
    let t = 0
    const result = await runCloud(
      buildPayload({ task: 'explain', sealedLetter: sealed.sealedText, language: 'es' }),
      sealed.entries,
      fakeSender(['Hola ', '⟦A_NUMBER_1⟧']),
      (s) => seen.push(s),
      undefined,
      () => (t += 10),
    )
    expect(seen).toEqual(['Hola ', 'Hola ⟦A_NUMBER_1⟧'])
    expect(result).toMatchObject({ text: 'Hola ⟦A_NUMBER_1⟧', inferenceSource: 'in_cloud', origin: 'real' })
    expect(result.firstTokenMs).not.toBeNull()
  })
})

describe('prompts', () => {
  it('include the sealed letter, the language and the no-legal-advice rule', () => {
    const p = buildCloudPrompt({ task: 'checklist', sealedLetter: sealed.sealedText, language: 'te' })
    expect(p).toContain(sealed.sealedText)
    expect(p).toContain('Telugu')
    expect(p).toContain('- [ ]')
    expect(CLOUD_SYSTEM_INSTRUCTION).toMatch(/Do not give legal advice/)
    expect(p).toContain('Do not suggest contacting an office, advisor or attorney')
  })

  it('ask for the referral once, on the first answer about an immigration letter', () => {
    const rfe = 'USCIS Request for Evidence, A-Number: ⟦A_NUMBER_1⟧, Form I-765'
    const rent = 'Maple Court Apartments. Rent of $1,450.00 is past due.'
    expect(touchesImmigration(rfe)).toBe(true)
    expect(touchesImmigration(rent)).toBe(false)
    expect(referralFor('explain', rfe, true)).toBe('immigration')
    expect(referralFor('checklist', rfe, false)).toBeNull()
    expect(referralFor('explain', rent, true)).toBeNull()
    const p = buildCloudPrompt({ task: 'explain', sealedLetter: rfe, language: 'en', referral: 'immigration' })
    expect(p).toMatch(/only one, suggesting the reader check .* international student office or a qualified immigration attorney/)
  })

  it('add a referral to a follow-up only when it asks for a legal judgment', () => {
    expect(asksForLegalJudgment('Can I upload the photos?')).toBe(false)
    expect(asksForLegalJudgment('Do I have to mail the photos, or can they be uploaded?')).toBe(false)
    expect(asksForLegalJudgment('Will I be out of status if I miss this?')).toBe(true)
    expect(asksForLegalJudgment('Can they evict me for this?')).toBe(true)
    expect(referralFor('followup', 'Rent notice', false, 'Is this late fee legal?')).toBe('legal')
    expect(referralFor('followup', 'Rent notice', false, 'When is it due?')).toBeNull()
  })

  it('carry the question and earlier answer for follow-ups', () => {
    const p = buildCloudPrompt({ task: 'followup', sealedLetter: 'L', language: 'en', question: 'Q?', previousAnswer: 'A.' })
    expect(p).toMatch(/YOUR EARLIER ANSWER[\s\S]*A\.[\s\S]*THE READER ASKS[\s\S]*Q\?/)
  })

  it('tell the on-device model not to bar dates and to copy values exactly', () => {
    expect(findSensitivePrompt('x')).toMatch(/Do NOT list deadlines/)
    expect(findSensitivePrompt('x')).toMatch(/exactly as it is written/)
    expect(glancePrompt('x', '2026-11-18')).toContain('Today is 2026-11-18')
  })

  it('offer at least the required languages', () => {
    const names = LANGUAGES.map((l) => l.name)
    for (const n of ['English', 'Spanish', 'Hindi', 'Telugu', 'Chinese (Simplified)', 'Vietnamese', 'Korean', 'Arabic']) expect(names).toContain(n)
  })
})

describe('glance validation', () => {
  const today = { year: 2026, month: 11, day: 18 }

  it('parses fenced JSON', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseModelJson('not json')).toBeNull()
  })

  it('computes days left and checks dates and amounts against the letter', () => {
    const g = normalizeGlance(
      {
        documentType: 'Request for evidence',
        sender: 'USCIS',
        summary: 's',
        asks: ['Send documents', ''],
        deadlines: [{ date: '2026-12-15', what: 'Response due' }, { date: '2026-12-20', what: 'Made up' }, { date: 'soon', what: 'bad' }],
        amounts: [{ amount: '$75', what: 'fee' }, { amount: '$9,999.00', what: 'made up' }],
      },
      LETTER,
      today,
    )
    expect(g?.asks).toEqual(['Send documents'])
    expect(g?.deadlines).toEqual([
      { date: '2026-12-15', what: 'Response due', days: 27, foundInLetter: true, from: 'model' },
      { date: '2026-12-20', what: 'Made up', days: 32, foundInLetter: false, from: 'model' },
    ])
    expect(g?.amounts.map((a) => a.foundInLetter)).toEqual([true, false])
    expect(primaryDeadline(g!)?.date).toBe('2026-12-15')
  })

  it('drops the letter date and adds deadlines the model missed', () => {
    const letter = 'Date: November 17, 2026\n\nSubmit the waiver by November 30, 2026. Pay by December 8, 2026.'
    const g = normalizeGlance(
      { documentType: 'Hold', sender: 'U', summary: 's', asks: [], amounts: [], deadlines: [{ date: '2026-11-17', what: 'Letter' }, { date: '2026-12-08', what: 'Pay the charge' }] },
      letter,
      today,
    )
    expect(g?.deadlines.map((d) => [d.date, d.from])).toEqual([
      ['2026-11-30', 'letter'],
      ['2026-12-08', 'model'],
    ])
    expect(g?.deadlines[0].what).toBe('Submit the waiver by November 30, 2026.')
    expect(primaryDeadline(g!)?.date).toBe('2026-11-30')
  })

  it('rejects empty output', () => {
    expect(normalizeGlance({}, 'A letter with no dates.', today)).toBeNull()
    expect(normalizeGlance(null, LETTER, today)).toBeNull()
  })
})

describe('cloud errors', () => {
  it('recognises an App Check rejection', () => {
    const f = classifyCloudError(new Error('[403] Firebase App Check token is invalid.'), true)
    expect(f.kind).toBe('app-check')
  })

  it('treats being offline as offline whatever the message', () => {
    expect(classifyCloudError(new Error('anything'), false).kind).toBe('offline')
  })

  it('recognises quota errors', () => {
    expect(classifyCloudError(new Error('[429 ] Resource exhausted'), true).kind).toBe('quota')
  })
})
