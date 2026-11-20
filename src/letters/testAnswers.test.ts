import { describe, expect, it } from 'vitest'
import { buildSamples } from './samples'
import { buildTestAnswer } from './testAnswers'
import { checkAnswer } from '../check/run'

const today = { year: 2026, month: 11, day: 19 }
const samples = buildSamples(today)

describe('test answers', () => {
  it('flag the moved deadline and the invented fee in each sample by code alone', async () => {
    for (const s of samples) {
      const t = buildTestAnswer(s.id, today)
      const r = await checkAnswer(t.text, [], s.text, null, () => {}, new AbortController().signal)
      const flagged = r.statements.filter((x) => x.verdict !== 'supported').map((x) => x.text).join(' | ')
      expect(flagged).toMatch(/\$(85|50|45)\.00/)
      expect(r.statements.some((x) => x.verdict === 'conflicts')).toBe(true)
    }
  })
})
