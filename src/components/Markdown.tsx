import { useState } from 'react'
import { parseMarkdown, type Inline } from '../lib/markdown'
import { WithBars, type Reveal } from './Inline'

function Inlines({ parts, reveal }: { parts: Inline[]; reveal: Reveal }) {
  return (
    <>
      {parts.map((p, i) =>
        p.type === 'strong' ? (
          <strong key={i}>
            <WithBars text={p.text} reveal={reveal} />
          </strong>
        ) : p.type === 'em' ? (
          <em key={i}>
            <WithBars text={p.text} reveal={reveal} />
          </em>
        ) : (
          <WithBars key={i} text={p.text} reveal={reveal} />
        ),
      )}
    </>
  )
}

function Task({ parts, initial, reveal, after }: { parts: Inline[]; initial: boolean; reveal: Reveal; after?: React.ReactNode }) {
  const [done, setDone] = useState(initial)
  return (
    <li className={`task${done ? ' is-done' : ''}`}>
      <label>
        <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
        <span>
          <Inlines parts={parts} reveal={reveal} />
        </span>
      </label>
      {after}
    </li>
  )
}

/** `after(key)` renders extra content at the end of a paragraph ("b3") or list item ("b4.2"). */
export function Markdown({ source, reveal, after }: { source: string; reveal: Reveal; after?: (key: string) => React.ReactNode }) {
  const blocks = parseMarkdown(source)
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading': {
            // Answer cards use h3 for their title, so every heading inside is h4.
            const H = 'h4'
            return (
              <H key={i}>
                <Inlines parts={b.inline} reveal={reveal} />
              </H>
            )
          }
          case 'paragraph':
            return (
              <div key={i} className="md-block">
                <p>
                  <Inlines parts={b.inline} reveal={reveal} />
                </p>
                {after?.(`b${i}`)}
              </div>
            )
          case 'rule':
            return <hr key={i} />
          case 'list': {
            const tasks = b.items.some((it) => it.checked !== null)
            const L = b.ordered ? 'ol' : 'ul'
            return (
              <L key={i} className={tasks ? 'tasks' : undefined}>
                {b.items.map((it, j) =>
                  it.checked !== null ? (
                    <Task key={j} parts={it.inline} initial={it.checked} reveal={reveal} after={after?.(`b${i}.${j}`)} />
                  ) : (
                    <li key={j}>
                      <Inlines parts={it.inline} reveal={reveal} />
                      {after?.(`b${i}.${j}`)}
                    </li>
                  ),
                )}
              </L>
            )
          }
        }
      })}
    </div>
  )
}
