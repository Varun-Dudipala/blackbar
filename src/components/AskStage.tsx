// Stage 3: see exactly what would leave the device, then optionally ask Gemini.

import { useMemo, useState } from 'react'
import { CLOUD_SYSTEM_INSTRUCTION, LANGUAGES, TASK_TITLE, isRtl, languageName, type CloudTask, type LanguageCode } from '../ai/prompts'
import { sealQuestion } from '../seal/question'
import { barCount, outboundStats } from '../seal/stats'
import type { Sealed } from '../seal/redact'
import { KIND_LABEL } from '../seal/kinds'
import type { Answer } from '../state/session'
import { WithBars, type Reveal } from './Inline'
import { Markdown } from './Markdown'

interface Props {
  sealed: Sealed
  answers: Answer[]
  online: boolean
  deviceOk: boolean
  patternOnly: boolean
  scanning: boolean
  onAsk: (task: Exclude<CloudTask, 'followup'>, language: LanguageCode) => void
  onFollowUp: (question: string, language: LanguageCode) => void
  onDevice: () => void
}

const ACTIONS: { task: Exclude<CloudTask, 'followup'>; label: string; note: string }[] = [
  { task: 'explain', label: 'Explain it plainly', note: 'What the letter says and why you got it' },
  { task: 'checklist', label: 'What should I do next?', note: 'Steps in order, with the deadline' },
  { task: 'draft', label: 'Draft a reply', note: 'A short reply you can edit and send' },
]

function SideBadge({ a }: { a: Answer }) {
  if (a.status === 'blocked') return <span className="tag tag-blocked">Not sent</span>
  // Development only: the condition is false in production builds, so this label is not shipped.
  if (import.meta.env.DEV && a.origin === 'mock') {
    return (
      <span className="tag" style={{ color: '#7a4700', borderStyle: 'dashed' }}>
        Mock cloud response, not from Gemini
      </span>
    )
  }
  if (a.origin === 'device') return <span className="tag tag-device">On this device</span>
  if (a.inferenceSource === 'in_cloud') return <span className="tag tag-cloud">Gemini, in the cloud</span>
  return <span className="tag tag-cloud">Cloud</span>
}

function AnswerCard({ a, reveal, onDevice, onRetry, deviceOk, online }: { a: Answer; reveal: Reveal; onDevice: () => void; onRetry?: () => void; deviceOk: boolean; online: boolean }) {
  const [copied, setCopied] = useState(false)
  const title = a.task === 'device' ? 'Plain explanation' : TASK_TITLE[a.task]
  const copy = async () => {
    let text = a.text
    if (reveal.show) for (const e of reveal.entries) text = text.split(e.placeholder).join(e.value)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }
  return (
    <article className={`answer is-${a.status} from-${a.origin}`} aria-busy={a.status === 'streaming'} data-testid="answer" data-status={a.status} data-source={a.inferenceSource ?? ''} data-ms={a.ms ?? ''} data-ttft={a.firstTokenMs ?? ''}>
      <header className="answer-head">
        <h3>
          {title}
          {a.language !== 'en' && <span className="muted"> · {languageName(a.language)}</span>}
        </h3>
        <SideBadge a={a} />
      </header>
      {a.questionSent !== undefined && (
        <p className="asked">
          <span className="eyebrow">{a.status === 'blocked' ? 'Your question, not sent' : 'Your question, as sent'}</span>
          <span className="asked-q">
            <WithBars text={a.questionSent} reveal={{ show: false, entries: reveal.entries }} />
          </span>
        </p>
      )}
      {a.status === 'blocked' && (
        <div className="notice notice-error" role="alert">
          <p>
            <strong>Not sent.</strong> This request contained details that are hidden in the letter, so Blackbar stopped it on this device:
          </p>
          <ul className="plain">
            {a.leaks?.map((l) => (
              <li key={l.placeholder}>
                <span className="chip">
                  <span>{l.placeholder.slice(1, -1).replace(/_(\d+)$/, ' $1').replace(/_/g, ' ')}</span>
                </span>{' '}
                {KIND_LABEL[l.kind]}{l.how === 'reformatted' ? ', written differently' : ''}
              </li>
            ))}
          </ul>
          <p className="fine">Take it out of your question and ask again.</p>
        </div>
      )}
      {a.status === 'error' && a.failure && (
        <div className="notice notice-calm" role="alert">
          <p>
            <strong>{a.failure.title}.</strong> {a.failure.detail}
          </p>
          <div className="notice-actions">
            {onRetry && online && a.failure.kind !== 'app-check' && a.failure.kind !== 'not-configured' && (
              <button type="button" className="btn btn-quiet btn-small" onClick={onRetry}>
                Try again
              </button>
            )}
            {a.origin !== 'device' && deviceOk && (
              <button type="button" className="btn btn-ink btn-small" onClick={onDevice}>
                Answer on this device instead
              </button>
            )}
          </div>
          {a.failure.technical && (
            <details className="tech">
              <summary>Technical details</summary>
              <code>{a.failure.technical}</code>
            </details>
          )}
        </div>
      )}
      {(a.status === 'streaming' || a.status === 'done') && (
        <div className="answer-body" dir={isRtl(a.language) ? 'rtl' : undefined} lang={a.language}>
          {a.text ? <Markdown source={a.text} reveal={reveal} /> : <p className="muted">{a.origin === 'device' ? 'Writing on this device.' : 'Sent. Waiting for Gemini.'}</p>}
          {a.status === 'streaming' && <span className="caret" aria-hidden="true" />}
        </div>
      )}
      {a.status === 'done' && (
        <footer className="answer-foot">
          <span className="fine muted">
            {a.origin === 'device'
              ? `Written by Chrome's built-in model in ${((a.ms ?? 0) / 1000).toFixed(1)} s from the full letter. Nothing was sent.`
              : import.meta.env.DEV && a.origin === 'mock'
                ? 'Development stand-in. No request was made.'
                : `Sent ${(a.wordsSent ?? 0).toLocaleString()} words, including Blackbar's instructions. No hidden detail was included. Answered in the cloud (inferenceSource ${a.inferenceSource ?? 'unknown'}); first words after ${((a.firstTokenMs ?? 0) / 1000).toFixed(1)} s, finished after ${((a.ms ?? 0) / 1000).toFixed(1)} s.`}
            {a.partial && ' Only the first part of this long letter was read.'}
          </span>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => void copy()}>
            {copied ? 'Copied' : reveal.show ? 'Copy with my details' : 'Copy with bars'}
          </button>
        </footer>
      )}
    </article>
  )
}

export function AskStage({ sealed, answers, online, deviceOk, patternOnly, scanning, onAsk, onFollowUp, onDevice }: Props) {
  const [language, setLanguage] = useState<LanguageCode>('en')
  const [show, setShow] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [question, setQuestion] = useState('')
  const stats = useMemo(() => outboundStats(sealed.sealedText, sealed.entries), [sealed])
  const preview = useMemo(() => (question.trim() ? sealQuestion(question, sealed.entries) : null), [question, sealed.entries])
  const busy = answers.some((a) => a.status === 'streaming') || scanning
  const reveal: Reveal = { show, entries: preview?.entries ?? sealed.entries }
  const hasCloudAnswer = answers.some((a) => a.status === 'done' && a.origin !== 'device')

  return (
    <div className="ask-grid">
      <section className="outbound" aria-labelledby="outbound-h">
        <h3 id="outbound-h">What leaves this device</h3>
        <dl className="stats">
          <div>
            <dt>Details hidden</dt>
            <dd data-testid="stat-sealed">
              {stats.sealed} <span className="stat-sub">{barCount(stats.bars)}</span>
            </dd>
          </div>
          <div>
            <dt>Hidden details in this text</dt>
            <dd className="zero">0</dd>
          </div>
          <div>
            <dt>Words of the letter</dt>
            <dd>{stats.words.toLocaleString()}</dd>
          </div>
        </dl>
        <div className="outbound-text" tabIndex={0} aria-label="The sealed text that would be sent" data-testid="outbound-text">
          <WithBars text={sealed.sealedText} reveal={{ show: false, entries: sealed.entries }} />
        </div>
        <p className="fine">
          The buttons below send this text, with Blackbar's instructions, to Gemini through Firebase AI Logic. Before each send, Blackbar checks the request for every hidden value, including copies written with different spacing or punctuation, and stops it if one is found.{' '}
          <button type="button" className="link" aria-expanded={showInstructions} onClick={() => setShowInstructions(!showInstructions)}>
            {showInstructions ? 'Hide the instructions' : 'Read the instructions'}
          </button>
        </p>
        {showInstructions && <pre className="instructions">{CLOUD_SYSTEM_INSTRUCTION}</pre>}
        {patternOnly && <p className="notice notice-warn">Only pattern checks have run on this letter. Check that names are blacked out before you send it.</p>}
      </section>

      <section className="asker" aria-labelledby="asker-h">
        <h3 id="asker-h" className="sr-only">
          Questions for Gemini
        </h3>
        {!online && (
          <div className="notice notice-calm" role="status">
            <p>
              <strong>This device is offline.</strong> Gemini needs a connection. Sealing, the summary and on-device answers still work.
            </p>
            {deviceOk && (
              <button type="button" className="btn btn-ink btn-small" onClick={onDevice} disabled={busy}>
                Answer on this device instead
              </button>
            )}
          </div>
        )}
        {import.meta.env.DEV && import.meta.env.VITE_MOCK_CLOUD === 'true' && <p className="notice notice-warn">Development build with VITE_MOCK_CLOUD=true. Cloud answers are a labelled mock and nothing is sent.</p>}
        <div className="lang">
          <label htmlFor="lang">Answer in</label>
          <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value as LanguageCode)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
                {l.native !== l.name ? ` · ${l.native}` : ''}
              </option>
            ))}
          </select>
        </div>
        {scanning && (
          <p className="notice notice-calm" role="status">
            Sending is paused until the on-device model finishes looking for names in the letter.
          </p>
        )}
        <div className="actions">
          {ACTIONS.map((a) => (
            <button key={a.task} type="button" className="action" data-task={a.task} disabled={busy || !online} onClick={() => onAsk(a.task, language)}>
              <span className="action-label">{a.label}</span>
              <span className="action-note">{a.note}</span>
            </button>
          ))}
        </div>
        <p className="fine legal">Blackbar explains letters and does not give legal advice. For questions about your immigration status, ask your school's international student office or an immigration attorney.</p>

        {answers.length > 0 && (
          <div className="answers">
            <div className="answers-bar">
              <label className="toggle">
                <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} data-testid="show-details" />
                <span>Show my details</span>
              </label>
              <span className="fine muted">{show ? 'Your details are filled in on this device only.' : 'Each bar stands for a hidden detail.'}</span>
            </div>
            {answers.map((a) => (
              <AnswerCard
                key={a.id}
                a={a}
                reveal={reveal}
                onDevice={onDevice}
                deviceOk={deviceOk}
                online={online}
                onRetry={a.task !== 'device' && a.task !== 'followup' ? () => onAsk(a.task as Exclude<CloudTask, 'followup'>, a.language) : undefined}
              />
            ))}
          </div>
        )}

        {hasCloudAnswer && (
          <form
            className="followup"
            onSubmit={(e) => {
              e.preventDefault()
              if (!question.trim() || busy) return
              onFollowUp(question, language)
              setQuestion('')
            }}
          >
            <label htmlFor="followup" className="field-label">
              Ask a follow-up
            </label>
            <textarea id="followup" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Can I ask for more time?" />
            {preview && (
              <p className="fine sent-preview">
                <span className="eyebrow">Will be sent as</span> <WithBars text={preview.sealedText} reveal={{ show: false, entries: preview.entries }} />
                {preview.hidden > 0 && <span className="muted"> ({preview.hidden} hidden)</span>}
              </p>
            )}
            <button type="submit" className="btn btn-ink" disabled={!question.trim() || busy || !online}>
              Ask
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
