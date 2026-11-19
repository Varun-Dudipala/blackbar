import type { Session } from '../state/session'

const SIDE: Record<string, string> = {
  on_device: 'On this device',
  in_cloud: 'Gemini, in the cloud',
  ...(import.meta.env.DEV ? { mock: 'Mock, no request made' } : {}),
  blocked: 'Stopped, not sent',
  failed: 'Failed',
}

export function Receipt({ session, sealedCount, barCount: bars, identifiersSent, onForget }: { session: Session; sealedCount: number; barCount: number; identifiersSent: number; onForget: () => void }) {
  return (
    <div className="receipt" data-testid="receipt">
      <div className="receipt-paper">
        <p className="receipt-title">Privacy receipt</p>
        <p className="fine muted">This visit only. Held in this tab's memory.</p>
        <dl className="receipt-totals">
          <div>
            <dt>Details hidden</dt>
            <dd data-testid="receipt-hidden">
              {sealedCount}
              {bars !== sealedCount && <span className="stat-sub"> ({bars} bars)</span>}
            </dd>
          </div>
          <div>
            <dt>Hidden details sent</dt>
            <dd data-testid="identifiers-sent">{identifiersSent}</dd>
          </div>
          <div>
            <dt>Words sent to Gemini</dt>
            <dd>{session.wordsSent.toLocaleString()}</dd>
          </div>
        </dl>
        <p className="receipt-rule" aria-hidden="true" />
        {session.calls.length === 0 ? (
          <p className="muted">No model has been used yet.</p>
        ) : (
          <table className="receipt-calls">
            <caption className="sr-only">Model calls this visit</caption>
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">Answered by</th>
                <th scope="col" className="num">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {session.calls.map((c) => (
                <tr key={c.id} data-side={c.side}>
                  <td>{c.label}</td>
                  <td>{SIDE[c.side]}</td>
                  <td className="num">{c.ms === undefined ? '—' : `${(c.ms / 1000).toFixed(1)} s`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="fine muted">"Answered by" is read from each Firebase AI Logic response (inferenceSource).</p>
      </div>
      <div className="forget">
        <p>The letter is kept in this tab only, and closing the tab forgets it. The one thing saved in this browser is your light or dark setting.</p>
        <button type="button" className="btn btn-quiet" onClick={onForget}>
          Forget this letter
        </button>
      </div>
    </div>
  )
}
