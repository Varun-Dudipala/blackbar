// The on-device check of a cloud answer: a quiet mark after each checked
// paragraph or list item, the statements and letter quotes behind it, and one
// summary line under the answer.

import type { ReactNode } from 'react'
import type { AnswerCheck } from '../state/session'
import { blockVerdict, numbersOnlyNote, summarise, summaryLine, type CheckedStatement, type Quote, type Verdict } from '../check/verdicts'
import { maskKnown } from '../seal/question'
import { WithBars, type Reveal } from './Inline'

const VERDICT_TEXT: Record<Verdict, string> = {
  supported: 'Matched to your letter',
  not_found: 'Could not be matched',
  conflicts: 'Differs from your letter',
  not_compared: 'Not compared',
}

const MARK_TEXT: Record<Verdict, string> = {
  supported: '',
  not_found: 'Not matched',
  conflicts: 'Differs',
  not_compared: 'Not compared',
}

function Tick() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path d="M2 6.5l2.6 2.5L10 3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

interface MarkProps {
  statements: CheckedStatement[]
  open: boolean
  onToggle: () => void
  onShowQuote: (q: Quote) => void
  reveal: Reveal
}

/** The mark after a block, and its details when open. */
export function CheckMark({ statements, open, onToggle, onShowQuote, reveal }: MarkProps): ReactNode {
  const v = blockVerdict(statements)
  if (!v) return null
  const label = MARK_TEXT[v]
  return (
    <>
      <button type="button" className={`check-mark is-${v}`} aria-expanded={open} aria-label={label ? `${label}: ${VERDICT_TEXT[v].toLowerCase()}. Show what was checked.` : `${VERDICT_TEXT[v]}. Show what was checked.`} onClick={onToggle} data-verdict={v}>
        {v === 'supported' ? <Tick /> : label}
      </button>
      {open && (
        <div className="check-detail">
          {statements.map((s) => (
            <div key={s.id} className={`check-item is-${s.verdict}`} data-verdict={s.verdict}>
              <p className="check-verdict">{VERDICT_TEXT[s.verdict]}</p>
              <p className="check-statement">
                <WithBars text={s.text} reveal={reveal} />
              </p>
              {s.quote && (
                <p className="check-quote">
                  <span className="eyebrow">{s.verdict === 'conflicts' ? 'The letter says' : 'In your letter'}</span>
                  <q>
                    <WithBars text={maskKnown(s.quote.text, reveal.entries)} reveal={reveal} />
                  </q>
                  <button type="button" className="link" onClick={() => onShowQuote(s.quote!)}>
                    Show in the letter
                  </button>
                </p>
              )}
              {s.note && <p className="fine">{s.note}</p>}
              {!s.quote && !s.note && s.verdict === 'not_found' && <p className="fine">No line of the letter could be matched to this. It may be general advice, or worded differently from the letter. Read it against the letter yourself.</p>}
              {s.verdict === 'not_compared' && <p className="fine">The answer is in another language than the letter, so its wording was not compared. Its dates, amounts and references, if any, match the letter.</p>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export function CheckLine({ check, deviceOk, languageName }: { check: AnswerCheck | undefined; deviceOk: boolean; languageName: string }) {
  if (!check) return null
  if (check.status === 'running') {
    return (
      <p className="check-line is-running" role="status" data-check="running">
        Checking this answer against your letter on this device{check.total > 1 ? `, part ${Math.min(check.done + 1, check.total)} of ${check.total}` : ''}. Nothing is sent.
      </p>
    )
  }
  if (check.status === 'cancelled') return <p className="check-line" data-check="cancelled">The check stopped because a newer answer was requested.</p>
  if (check.status === 'error') return <p className="check-line is-flag" data-check="error">This answer could not be checked on this device. {check.message}</p>
  const s = summarise(check.result.statements)
  const flagged = s.notFound + s.conflicts
  return (
    <p className={`check-line${flagged ? ' is-flag' : ''}`} role="status" data-check="done" data-supported={s.supported} data-not-found={s.notFound} data-conflicts={s.conflicts} data-total={s.total}>
      {summaryLine(s, check.result.mode, languageName)}
      {check.result.mode === 'numbers' && (deviceOk ? '' : numbersOnlyNote(check.result.skipped ?? 0))}
      {s.conflicts > 0 && ' Press a mark to see what the letter says.'}
    </p>
  )
}
