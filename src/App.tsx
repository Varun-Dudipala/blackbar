import { useEffect, useMemo, useRef } from 'react'
import { buildSamples } from './letters/samples'
import { scrollToId, useDevice, useOnline, useTheme } from './state/hooks'
import { useBlackbar } from './state/useBlackbar'
import { DeviceChip, StageRail, ThemeSwitch, Wordmark, type StageState } from './components/Chrome'
import { BringStage } from './components/BringStage'
import { SealStage } from './components/SealStage'
import { AskStage } from './components/AskStage'
import { Receipt } from './components/Receipt'
import { hiddenSummary } from './seal/stats'

function Stage({ id, n, title, lede, children }: { id: string; n: number; title: string; lede: string; children: React.ReactNode }) {
  return (
    <section id={id} className="stage" aria-labelledby={`${id}-h`}>
      <header className="stage-head">
        <span className="stage-n" aria-hidden="true">
          {n}
        </span>
        <div>
          <h2 id={`${id}-h`}>{title}</h2>
          <p className="lede">{lede}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>
}

export default function App() {
  const device = useDevice()
  const online = useOnline()
  const [theme, setTheme] = useTheme()
  const samples = useMemo(() => buildSamples(), [])
  const bb = useBlackbar(device, online)
  const { session, sealed } = bb
  const lastLetter = useRef<string | null>(null)

  useEffect(() => {
    const text = session.letter?.text ?? null
    if (text && text !== lastLetter.current) requestAnimationFrame(() => scrollToId('seal'))
    lastLetter.current = text
  }, [session.letter])

  const deviceOk = device.status.state === 'ready' || device.status.state === 'downloading' || device.status.state === 'downloadable'
  const patternOnly = !!session.letter && (session.scan.status === 'error' || device.status.state === 'unsupported' || device.status.state === 'unavailable')
  const asked = session.answers.length > 0

  const stages: { id: string; n: number; title: string; note: string; state: StageState }[] = [
    { id: 'bring', n: 1, title: 'Bring a letter', note: session.letter ? session.letter.title : 'Text, photo or sample', state: session.letter ? 'done' : 'current' },
    {
      id: 'seal',
      n: 2,
      title: 'Seal',
      note: session.letter && sealed ? hiddenSummary(sealed.entries.length, session.spans.length) : 'On this device',
      state: !session.letter ? 'waiting' : asked ? 'done' : 'current',
    },
    { id: 'ask', n: 3, title: 'Ask the cloud', note: asked ? `${session.answers.length} answer${session.answers.length === 1 ? '' : 's'}` : 'Optional, sealed text only', state: asked ? 'current' : 'waiting' },
  ]

  const forget = () => {
    bb.dispatch({ type: 'reset' })
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('blackbar.')) localStorage.removeItem(k)
    } catch {
      /* storage blocked */
    }
    setTheme('system')
    scrollToId('top')
  }

  return (
    <>
      <a className="skip" href="#bring">
        Skip to the letter
      </a>
      <header className="top" id="top">
        <div className="top-inner">
          <div className="top-left">
            <Wordmark />
            <span className="tagline">Reads official letters on this computer and hides your identifiers before anything is sent.</span>
          </div>
          <div className="top-tools">
            <DeviceChip status={device.status} onPrepare={() => void device.prepare()} />
            <ThemeSwitch theme={theme} onChange={setTheme} />
          </div>
        </div>
      </header>

      <main>
        <h1 className="sr-only">Blackbar</h1>
        {(device.status.state === 'unsupported' || device.status.state === 'unavailable') && (
          <div className="notice notice-warn device-note" role="status">
            <p>
              <strong>This browser has no on-device model.</strong> Pattern checks still hide Social Security numbers, A-numbers, SEVIS IDs, receipt numbers, phone numbers and street addresses. Names are not found automatically here, so black them out by hand before sending anything.
            </p>
            <p className="fine">{device.status.reason}</p>
          </div>
        )}
        <StageRail stages={stages} />

        <Stage id="bring" n={1} title="Bring a letter" lede="Paste the text, add a photo or scan, or open a sample. Nothing is read until you choose one.">
          <BringStage downloadNeeded={device.status.state === 'downloadable'} samples={samples} device={device.status} prepare={device.prepare} current={session.letter} onLetter={bb.startLetter} onCall={(call) => bb.dispatch({ type: 'call', call })} />
        </Stage>

        <Stage id="seal" n={2} title="Seal" lede="Each identifier found on this device is under a black bar. Press a bar to check it, or select text to add one. Nothing has been sent.">
          {session.letter && sealed ? (
            <SealStage session={session} sealed={sealed} device={device.status} dispatch={bb.dispatch} onRescan={bb.rescan} />
          ) : (
            <Empty>
              <p>No letter yet.</p>
            </Empty>
          )}
        </Stage>

        <Stage id="ask" n={3} title="Ask the cloud" lede="Optional. Gemini receives the sealed text shown below and nothing else.">
          {session.letter && sealed ? (
            <AskStage
              sealed={sealed}
              answers={session.answers}
              online={online}
              deviceOk={deviceOk}
              patternOnly={patternOnly}
              scanning={session.scan.status === 'running' || (session.scan.status === 'idle' && device.status.state !== 'unsupported' && device.status.state !== 'unavailable')}
              onAsk={(task, lang) => void bb.ask(task, lang)}
              onFollowUp={(q, lang) => void bb.followUp(q, lang)}
              onDevice={() => void bb.answerOnDevice()}
            />
          ) : (
            <Empty>
              <p>Seal a letter first. The text that would be sent appears here before anything is sent.</p>
            </Empty>
          )}
        </Stage>

        <section id="receipt" className="stage stage-receipt" aria-labelledby="receipt-h">
          <h2 id="receipt-h" className="sr-only">
            Privacy receipt
          </h2>
          <Receipt session={session} sealedCount={sealed?.entries.length ?? 0} barCount={session.spans.length} identifiersSent={bb.identifiersSent} onForget={forget} />
        </section>
      </main>

      <footer className="foot">
        <p>Blackbar has no accounts and keeps nothing on a server. Both models run through Firebase AI Logic. Chrome's built-in model works on this computer; Gemini runs in Google's cloud and only sees sealed text.</p>
      </footer>
    </>
  )
}
