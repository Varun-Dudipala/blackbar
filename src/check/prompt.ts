// Prompt and schema for the on-device verdicts, and how statements are batched.

import { estimateTokens } from '../lib/chunk'
import type { Passage } from './passages'

export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          verdict: { type: 'string', enum: ['supported', 'not_in_letter'] },
          quotes: { type: 'array', items: { type: 'string' }, maxItems: 2 },
        },
        required: ['id', 'verdict', 'quotes'],
      },
    },
  },
  required: ['results'],
} as const

export interface CheckItem {
  id: number
  text: string
  passages: Passage[]
}

export function verdictPrompt(items: CheckItem[]): string {
  const blocks = items
    .map((it) => {
      const ps = it.passages.map((p) => `  > ${p.text.replace(/\s+/g, ' ')}`).join('\n')
      return `STATEMENT ${it.id}: ${it.text}\nLETTER PASSAGES FOR ${it.id}:\n${ps}`
    })
    .join('\n\n')
  return `You check an explanation of an official letter against the letter itself.
For each statement, decide whether its letter passages say the same thing:
- "supported": a passage says this. A statement that is shorter, reworded or leaves out details is still supported if nothing in it is different.
- "not_in_letter": no passage says this. General advice and anything added by the explanation are not_in_letter.
Names, reference numbers and addresses shown in [brackets] were copied from the letter.
For "supported", quotes: copy the words from the passage that says it, exactly as written, 6 to 40 words. If the statement joins two points from the letter, give two quotes, one for each. For "not_in_letter", quotes is [].
The statement may be in another language; compare the meaning.

${blocks}`
}

/** Groups statements so each request stays well inside the 9,216-token limit and returns quickly. */
export function batchItems(items: CheckItem[], maxItems = 6, maxTokens = 3000): CheckItem[][] {
  const out: CheckItem[][] = []
  let cur: CheckItem[] = []
  for (const it of items) {
    const next = [...cur, it]
    if (cur.length && (next.length > maxItems || estimateTokens(verdictPrompt(next)) > maxTokens)) {
      out.push(cur)
      cur = [it]
    } else cur = next
  }
  if (cur.length) out.push(cur)
  return out
}
