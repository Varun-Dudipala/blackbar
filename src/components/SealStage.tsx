// Stage 2: the sealed letter and the on-device "at a glance" card.

import { useState } from 'react'
import type { DeviceStatus } from '../ai/device'
import { primaryDeadline, type GlanceDeadline } from '../ai/glance'
import { buildIcs, icsFileName, scrubForCalendar } from '../lib/ics'
import { describeDays, formatLong, formatWeekday, parseIsoDate } from '../lib/dates'
import { findWholeOccurrences } from '../seal/modelSpans'
import { maskKnown } from '../seal/question'
import { barCount, hiddenSummary } from '../seal/stats'
import type { Sealed } from '../seal/redact'
import type { Session } from '../state/session'
import type { Action } from '../state/session'
import { SealedDocument } from './SealedDocument'
import { guessKind } from '../seal/kinds'
import { WithBars } from './Inline'

interface Props {
  session: Session
  sealed: Sealed
  device: DeviceStatus
  dispatch: (a: Action) => void
  onRescan: () => void
  onDownload: () => void
}

function OnDeviceTag() {
  return <span className="tag tag-device">On this device</span>
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ScanLine({ session, details, device, onRescan, onDownload }: { session: Session; details: number; device: DeviceStatus; onRescan: () => void; onDownload: () => void }) {
  const counts = { pattern: 0, model: 0, user: 0 }
  for (const s of session.spans) counts[s.source]++
  const bits = [`${barCount(counts.pattern)} from pattern checks`]
  if (counts.model) bits.push(`${barCount(counts.model)} from the on-device model`)
  if (counts.user) bits.push(`${barCount(counts.user)} added by you`)
  let status: React.ReactNode
  const notChecked = 'Only pattern checks ran. Names and unusual reference numbers were not looked for.'
  if (session.scan.status === 'running')
    status = <span className="scan-run">The on-device model is checking the letter for names and other reference numbers. New bars may appear, and sending waits until it finishes.</span>
  else if (session.scan.status === 'done') status = <span>The on-device model has finished{session.scan.value.chunks > 1 ? ` (it read the letter in ${session.scan.value.chunks} parts)` : ''}. Check the bars against your letter before you send anything.</span>
  else if (session.scan.status === 'error')
    status = (
      <span className="warn">
        {session.scan.tooLong ? 'This letter is too long for the on-device model.' : 'The on-device model stopped before it finished.'} Only pattern checks ran, so names may still be visible.{' '}
        <button type="button" className="link" onClick={onRescan}>
          Try again
        </button>
      </span>
    )
  else if (device.state === 'unsupported' || device.state === 'unavailable')
    status = <span className="warn">{notChecked} Black them out by hand before you send anything.</span>
  else if (device.state === 'downloadable')
    status = (
      <span className="warn">
        {notChecked} Chrome's on-device model can also find names, read photos and write the summary.{' '}
        <button type="button" className="link" onClick={onDownload} data-testid="inline-download">
          Download it (about 2.5 GB)
        </button>
      </span>
    )
  else if (device.state === 'downloading')
    status = (
      <span>
        {notChecked} Chrome is downloading its model{device.progress !== null ? ` (${Math.floor(device.progress * 100)}%)` : ''}. When it finishes, the model checks this letter and new bars may appear. You can send before then.
      </span>
    )
  else if (device.state === 'stalled')
    status = (
      <span className="warn">
        {notChecked}{' '}
        {device.reason === 'error'
          ? "Chrome's model download failed."
          : 'Chrome has not started the model download.'}{' '}
        The usual cause is free disk space: Chrome needs about 22 GB free to install the model.{' '}
        <button type="button" className="link" onClick={onDownload} data-testid="inline-download">
          Try the download again
        </button>
      </span>
    )
  else status = <span>Checking whether Chrome's on-device model is available.</span>
  return (
    <div className="scanline" role="status" aria-live="polite" data-scan={session.scan.status}>
      <strong data-testid="hidden-summary">{hiddenSummary(details, session.spans.length)} on this device.</strong> <span className="muted">{bits.join(', ')}.</span>
      <br />
      {status}
    </div>
  )
}

function AddBar({ text, onAdd }: { text: string; onAdd: (start: number, end: number) => void }) {
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  return (
    <form
      className="addbar"
      onSubmit={(e) => {
        e.preventDefault()
        const v = value.trim()
        if (!v) return
        const hits = findWholeOccurrences(text, v)
        if (!hits.length) return setNote(`"${v}" is not in the letter exactly as typed.`)
        for (const at of hits) onAdd(at, at + v.length)
        setNote(`Added ${hits.length} ${hits.length === 1 ? 'bar' : 'bars'}.`)
        setValue('')
      }}
    >
      <label htmlFor="addbar" className="field-label">
        Black out anything else
      </label>
      <p className="fine">Select it in the letter, or type it here. Every place it appears gets a bar.</p>
      <div className="addbar-row">
        <input id="addbar" value={value} onChange={(e) => setValue(e.target.value)} placeholder="A name, a number, a street" autoComplete="off" />
        <button type="submit" className="btn btn-quiet">
          Black out
        </button>
      </div>
      <p className="fine" role="status">
        {note}
      </p>
    </form>
  )
}

function DeadlineBlock({ d, letterTitle, sealed }: { d: GlanceDeadline; letterTitle: string; sealed: Sealed }) {
  const date = parseIsoDate(d.date)
  if (!date) return null
  const urgent = d.days >= 0 && d.days <= 7
  const addToCalendar = () => {
    const title = scrubForCalendar(`Deadline: ${letterTitle}`, sealed.entries)
    const description = scrubForCalendar(`${d.what}\n\nCreated by Blackbar. Names and numbers from the letter are left out of this file.`, sealed.entries)
    download(icsFileName(title, d.date), buildIcs({ date: d.date, title, description, uid: `${d.date}-${letterTitle.replace(/\W+/g, '-')}@blackbar.local`, stamp: new Date() }), 'text/calendar')
  }
  return (
    <div className={`deadline${urgent ? ' is-urgent' : ''}${d.days < 0 ? ' is-past' : ''}`}>
      <p className="eyebrow">Deadline</p>
      <p className="deadline-date" data-deadline={d.date}>
        {formatLong(date)}
      </p>
      <p className="deadline-days">
        {formatWeekday(date)} · <strong>{d.days < 0 ? `passed ${describeDays(d.days)}` : describeDays(d.days)}</strong>
      </p>
      <p className={`deadline-what${d.from === 'letter' ? ' is-quote' : ''}`}>
        <WithBars text={maskKnown(d.what, sealed.entries)} reveal={{ show: false, entries: sealed.entries }} />
      </p>
      {!d.foundInLetter && <p className="fine warn">This exact date is not printed in the letter. The model worked it out, so check it.</p>}
      <button type="button" className="btn btn-quiet btn-small" onClick={addToCalendar}>
        Add to calendar (.ics)
      </button>
    </div>
  )
}

function GlanceCard({ session, sealed, device }: { session: Session; sealed: Sealed; device: DeviceStatus }) {
  const g = session.glance
  const reveal = { show: false, entries: sealed.entries }
  const mask = (t: string) => <WithBars text={maskKnown(t, sealed.entries)} reveal={reveal} />
  if (g.status === 'idle') {
    const off = device.state === 'unsupported' || device.state === 'unavailable'
    return (
      <aside className="glance is-empty" aria-label="At a glance">
        <h3>At a glance</h3>
        <p className="muted">
          {off
            ? 'The summary needs an on-device model, which this browser does not have.'
            : device.state === 'downloading'
              ? "The summary appears here when Chrome finishes downloading its model."
              : device.state === 'ready' || device.state === 'checking'
                ? 'Waiting for the on-device model.'
                : "The summary needs Chrome's on-device model, which is not downloaded on this computer."}
        </p>
      </aside>
    )
  }
  if (g.status === 'running') {
    return (
      <aside className="glance is-loading" aria-label="At a glance" aria-busy="true" data-status="running">
        <div className="glance-head">
          <h3>At a glance</h3>
          <OnDeviceTag />
        </div>
        <p className="muted" role="status">
          Reading the letter on this device. This takes 6 to 10 seconds.
        </p>
        <div className="skeleton" aria-hidden="true">
          <i style={{ width: '70%' }} />
          <i style={{ width: '45%' }} />
          <i className="big" style={{ width: '60%' }} />
          <i style={{ width: '85%' }} />
          <i style={{ width: '55%' }} />
        </div>
      </aside>
    )
  }
  if (g.status === 'error') {
    return (
      <aside className="glance is-error" aria-label="At a glance" data-status="error">
        <h3>At a glance</h3>
        <p role="alert">{g.tooLong ? 'This letter is too long for the on-device model to summarise in one request. Its limit is 9,216 tokens, about 35,000 characters.' : 'The on-device model stopped before the summary was finished.'}</p>
        <p className="fine muted">{g.message}</p>
      </aside>
    )
  }
  const { glance, call, partial } = g.value
  const main = primaryDeadline(glance)
  const others = glance.deadlines.filter((d) => d !== main)
  return (
    <aside className="glance" aria-label="At a glance" data-testid="glance" data-status="done">
      <div className="glance-head">
        <h3>At a glance</h3>
        <OnDeviceTag />
      </div>
      <p className="glance-type">{mask(glance.documentType || 'Official letter')}</p>
      {glance.sender && <p className="glance-from">From {mask(glance.sender)}</p>}
      {glance.summary && <p className="glance-summary">{mask(glance.summary)}</p>}
      {main ? <DeadlineBlock d={main} letterTitle={glance.documentType || 'letter'} sealed={sealed} /> : <p className="muted">No deadline in this letter.</p>}
      {others.length > 0 && (
        <div className="glance-sec">
          <p className="eyebrow">Other dates</p>
          <ul className="plain">
            {others.map((d) => {
              const date = parseIsoDate(d.date)
              return (
                <li key={d.date} data-deadline={d.date}>
                  <strong>{date ? formatLong(date) : d.date}</strong> ({d.days < 0 ? `passed ${describeDays(d.days)}` : describeDays(d.days)}) — {mask(d.what)}
                  {!d.foundInLetter && <span className="warn"> · check this date</span>}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {glance.asks.length > 0 && (
        <div className="glance-sec">
          <p className="eyebrow">What the letter asks of you</p>
          <ul className="plain asks">
            {glance.asks.map((a, i) => (
              <li key={i}>{mask(a)}</li>
            ))}
          </ul>
        </div>
      )}
      {glance.amounts.length > 0 && (
        <div className="glance-sec">
          <p className="eyebrow">Amounts</p>
          <ul className="plain amounts">
            {glance.amounts.map((a) => (
              <li key={a.amount}>
                <strong className="amount">{a.amount}</strong> {mask(a.what)}
                {!a.foundInLetter && <span className="warn"> · not found in the letter, check it</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="fine muted glance-foot">
        Read on this device by Chrome's built-in model in {(call.ms / 1000).toFixed(1)} s. It can make mistakes, so check it against the letter.
        {partial && ' The letter is long, so only its first part was summarised.'}
      </p>
    </aside>
  )
}

export function SealStage({ session, sealed, device, dispatch, onRescan, onDownload }: Props) {
  const letter = session.letter
  if (!letter) return null
  return (
    <div className="seal-grid">
      <div className="seal-main">
        <ScanLine session={session} details={sealed.entries.length} device={device} onRescan={onRescan} onDownload={onDownload} />
        <article className="paper" aria-label={`${letter.title}, sealed`}>
          <header className="paper-head">
            <span>{letter.title}</span>
            <span className="stamp" aria-hidden="true">
              Sealed
            </span>
          </header>
          <SealedDocument
            text={letter.text}
            spans={session.spans}
            keptVisible={session.keptVisible}
            onUnseal={(start) => dispatch({ type: 'unseal', start })}
            onReseal={(start) => dispatch({ type: 'reseal', start })}
            onAddBar={(start, end, kind) => dispatch({ type: 'add-bar', start, end, kind })}
          />
        </article>
        <AddBar text={letter.text} onAdd={(start, end) => dispatch({ type: 'add-bar', start, end, kind: guessKind(letter.text.slice(start, end)) })} />
      </div>
      <GlanceCard session={session} sealed={sealed} device={device} />
    </div>
  )
}
