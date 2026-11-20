// Fixed test answers, one per sample letter, each with three mistakes planted
// on purpose: a moved deadline, an invented fee and an invented requirement.
// They are written here, not by Gemini, so anyone can see what the answer
// check does with a wrong answer. Using one makes no request.

import { addDays, formatLong, localToday, type CalendarDate } from '../lib/dates'
import type { SampleLetter } from './samples'

export interface TestAnswer {
  text: string
  /** What was planted, in plain words, for the answer's footer. */
  planted: string[]
}

export function buildTestAnswer(id: SampleLetter['id'], today: CalendarDate = localToday()): TestAnswer {
  const d = (n: number) => formatLong(addDays(today, n))
  if (id === 'rfe') {
    return {
      text: [
        '### What this letter is',
        'USCIS sent this request for evidence about your Form I-765 application for optional practical training.',
        '',
        '### What it asks for',
        '- A copy of the Form I-20 endorsed by your Designated School Official within the last 30 days.',
        '- Two passport-style photographs with your name and A-Number written lightly on the back.',
        '- A letter from your employer confirming your job offer and salary.',
        '- A processing fee of $85.00, paid by money order.',
        '',
        '### Deadline',
        `Your response must be received by ${d(34)}.`,
      ].join('\n'),
      planted: [`the deadline moved to ${d(34)}`, 'an $85.00 fee the letter does not ask for', 'a letter from your employer the letter does not ask for'],
    }
  }
  if (id === 'rent') {
    return {
      text: [
        '### What this letter is',
        'Maple Court Apartments sent this notice because this month’s rent has not been received.',
        '',
        '### What it asks',
        '- Pay the total now due of $1,525.00 through the resident portal, by money order at the office, or by check.',
        '- Write your Tenant ID on the check.',
        '- Pay an extra returned-check fee of $50.00.',
        '- Bring proof of renter’s insurance to the office.',
        '',
        '### Deadline',
        `Pay the full amount by ${d(12)}.`,
      ].join('\n'),
      planted: [`the deadline moved to ${d(12)}`, 'a $50.00 fee the letter does not ask for', 'proof of renter’s insurance the letter does not ask for'],
    }
  }
  return {
    text: [
      '### What this letter is',
      'Example State University placed a financial hold on your registration because of the spring health insurance charge.',
      '',
      '### Your options',
      `- Submit the online waiver form with your policy details by ${d(19)}.`,
      `- Pay the $1,286.00 charge, or enroll in a payment plan, by ${d(20)}.`,
      '- Pay a late registration fee of $45.00.',
      '- Include a letter from your bank with the waiver.',
    ].join('\n'),
    planted: [`the waiver deadline moved to ${d(19)}`, 'a $45.00 fee the letter does not ask for', 'a letter from your bank the letter does not ask for'],
  }
}
