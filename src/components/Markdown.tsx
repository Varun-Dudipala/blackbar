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

function Task({ parts, initial, reveal }: { parts: Inline[]; initial: boolean; reveal: Reveal }) {
  const [done, setDone] = useState(initial)
  return (
    <li className={`task${done ? ' is-done' : ''}`}>
      <label>
        <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
        <span>
          <Inlines parts={parts} reveal={reveal} />
        </span>
      </label>
    </li>
  )
}

export function Markdown({ source, reveal }: { source: string; reveal: Reveal }) {
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
              <p key={i}>
                <Inlines parts={b.inline} reveal={reveal} />
              </p>
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
                    <Task key={j} parts={it.inline} initial={it.checked} reveal={reveal} />
                  ) : (
                    <li key={j}>
                      <Inlines parts={it.inline} reveal={reveal} />
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
