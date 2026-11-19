// The letter as a document, with a black bar over every identifier. Bars are
// buttons: pressing one opens its details, where the reader can peek or keep
// it visible. Selecting text offers "Black this out".

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Kind, Span } from '../seal/detectors'
import { KIND_LABEL, KINDS, SOURCE_LABEL, guessKind } from '../seal/kinds'

interface Props {
  text: string
  spans: Span[]
  keptVisible: Span[]
  onUnseal: (start: number) => void
  onReseal: (start: number) => void
  onAddBar: (start: number, end: number, kind: Kind) => void
  /** A passage to show, from an answer check. Changing `n` scrolls to it again. */
  highlight?: { start: number; end: number; n: number } | null
}

type Segment = { type: 'text'; start: number; text: string; quote?: boolean } | { type: 'bar' | 'kept'; span: Span; index: number; quote?: boolean }

function segments(text: string, spans: Span[], kept: Span[]): Segment[] {
  const all = [...spans.map((s) => ({ s, kept: false })), ...kept.map((s) => ({ s, kept: true }))].sort((a, b) => a.s.start - b.s.start)
  const out: Segment[] = []
  let cursor = 0
  let index = 0
  for (const { s, kept: isKept } of all) {
    if (s.start < cursor) continue
    if (s.start > cursor) out.push({ type: 'text', start: cursor, text: text.slice(cursor, s.start) })
    out.push({ type: isKept ? 'kept' : 'bar', span: { ...s, text: text.slice(s.start, s.end) }, index: index++ })
    cursor = s.end
  }
  if (cursor < text.length) out.push({ type: 'text', start: cursor, text: text.slice(cursor) })
  return out
}

/** Splits text segments at the edges of a quoted passage and marks what lies inside it. */
function markQuote(segs: Segment[], q: { start: number; end: number } | null | undefined): Segment[] {
  if (!q) return segs
  const out: Segment[] = []
  for (const seg of segs) {
    if (seg.type !== 'text') {
      out.push({ ...seg, quote: seg.span.start < q.end && q.start < seg.span.end })
      continue
    }
    const a = seg.start
    const b = seg.start + seg.text.length
    if (b <= q.start || q.end <= a) {
      out.push(seg)
      continue
    }
    const cuts = [a, Math.max(a, q.start), Math.min(b, q.end), b]
    for (let i = 0; i < 3; i++) {
      if (cuts[i + 1] > cuts[i]) out.push({ type: 'text', start: cuts[i], text: seg.text.slice(cuts[i] - a, cuts[i + 1] - a), quote: i === 1 })
    }
  }
  return out
}

/** Character offset in the letter for a DOM point inside the document. */
function offsetOf(node: Node, offset: number, root: HTMLElement, atEnd: boolean): number | null {
  let el: HTMLElement | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
  while (el && el !== root && el.dataset.o === undefined) el = el.parentElement
  if (!el || el === root) {
    // Selection boundary on the root itself: use the child at that position.
    if (node === root) {
      const child = root.childNodes[Math.min(offset, root.childNodes.length - 1)] as HTMLElement | undefined
      if (child?.dataset?.o !== undefined) return Number(atEnd ? child.dataset.e : child.dataset.o)
    }
    return null
  }
  const start = Number(el.dataset.o)
  if (el.dataset.e !== undefined && el.dataset.bar !== undefined) return atEnd ? Number(el.dataset.e) : start
  return start + (node.nodeType === Node.TEXT_NODE ? offset : 0)
}

interface Selected {
  start: number
  kept: boolean
}

interface Pending {
  start: number
  end: number
  kind: Kind
  top: number
  left: number
}

export function SealedDocument({ text, spans, keptVisible, onUnseal, onReseal, onAddBar, highlight }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [peek, setPeek] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const segs = useMemo(() => markQuote(segments(text, spans, keptVisible), highlight), [text, spans, keptVisible, highlight])

  useEffect(() => {
    if (!highlight) return
    const el = textRef.current?.querySelector('.in-quote')
    el?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  }, [highlight])
  const current = selected ? (selected.kept ? keptVisible : spans).find((s) => s.start === selected.start) : undefined

  const close = useCallback((refocus: boolean) => {
    const start = selected?.start
    setSelected(null)
    setPeek(false)
    if (refocus && start !== undefined) {
      requestAnimationFrame(() => textRef.current?.querySelector<HTMLElement>(`[data-o="${start}"][data-bar]`)?.focus())
    }
  }, [selected])

  useLayoutEffect(() => {
    if (!selected || !rootRef.current) return setPos(null)
    const btn = rootRef.current.querySelector<HTMLElement>(`[data-o="${selected.start}"][data-bar]`)
    if (!btn) return setPos(null)
    const r = btn.getBoundingClientRect()
    const base = rootRef.current.getBoundingClientRect()
    const width = Math.min(300, base.width - 16)
    const left = Math.max(8, Math.min(r.left - base.left, base.width - width - 8))
    setPos({ top: r.bottom - base.top + 8, left })
  }, [selected, spans, keptVisible])

  useEffect(() => {
    if (selected && pos) popRef.current?.querySelector<HTMLElement>('button')?.focus()
  }, [selected, pos])

  useEffect(() => {
    if (!selected && !pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPending(null)
        close(true)
      }
    }
    const onDown = (e: PointerEvent) => {
      if (popRef.current?.contains(e.target as Node)) return
      if ((e.target as HTMLElement).closest?.('[data-bar]')) return
      setPending(null)
      close(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [selected, pending, close])

  const readSelection = useCallback(() => {
    const root = textRef.current
    const sel = window.getSelection()
    if (!root || !rootRef.current || !sel || sel.rangeCount === 0 || sel.isCollapsed) return setPending(null)
    const range = sel.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) return setPending(null)
    const a = offsetOf(range.startContainer, range.startOffset, root, false)
    const b = offsetOf(range.endContainer, range.endOffset, root, true)
    if (a === null || b === null) return setPending(null)
    let start = Math.min(a, b)
    let end = Math.max(a, b)
    while (start < end && /\s/.test(text[start])) start++
    while (end > start && /\s/.test(text[end - 1])) end--
    if (end <= start) return setPending(null)
    const r = range.getBoundingClientRect()
    const base = rootRef.current.getBoundingClientRect()
    setSelected(null)
    setPending({ start, end, kind: guessKind(text.slice(start, end)), top: r.bottom - base.top + 8, left: Math.max(8, Math.min(r.left - base.left, base.width - 290)) })
  }, [text])

  const confirmPending = () => {
    if (!pending) return
    onAddBar(pending.start, pending.end, pending.kind)
    window.getSelection()?.removeAllRanges()
    setPending(null)
  }

  return (
    <div className="doc-wrap" ref={rootRef}>
      <div
        className="doc-text"
        ref={textRef}
        onPointerUp={() => setTimeout(readSelection, 0)}
        onKeyUp={(e) => {
          if (e.shiftKey) readSelection()
        }}
      >
        {segs.map((seg) => {
          if (seg.type === 'text') {
            return (
              <span key={`t${seg.start}`} data-o={seg.start} className={seg.quote ? 'in-quote' : undefined}>
                {seg.text}
              </span>
            )
          }
          const { span } = seg
          const label = KIND_LABEL[span.kind]
          if (seg.type === 'kept') {
            return (
              <button
                key={`k${span.start}-${span.end}`}
                type="button"
                className="kept"
                data-o={span.start}
                data-e={span.end}
                data-bar=""
                aria-label={`Visible: ${label}, "${span.text}". You chose to send this as written. Press to review.`}
                onClick={() => setSelected({ start: span.start, kept: true })}
              >
                {span.text}
              </button>
            )
          }
          return (
            <button
              key={`b${span.start}-${span.end}`}
              type="button"
              className={`bar src-${span.source}${seg.quote ? ' in-quote' : ''}`}
              style={{ ['--i' as string]: Math.min(seg.index, 24) }}
              data-o={span.start}
              data-e={span.end}
              data-text={span.text}
              data-bar=""
              aria-label={`Hidden: ${label}. ${SOURCE_LABEL[span.source]}. Press to review.`}
              aria-expanded={selected?.start === span.start}
              onClick={() => {
                setPending(null)
                setPeek(false)
                setSelected(selected?.start === span.start ? null : { start: span.start, kept: false })
              }}
            >
              {/* No text inside: CSS draws the value from data-text in transparent
                  ink, so the bar keeps the width of the text it covers. */}
            </button>
          )
        })}
      </div>

      {selected && current && pos && (
        <div className="pop" role="dialog" aria-label={`${KIND_LABEL[current.kind]} details`} ref={popRef} style={{ top: pos.top, left: pos.left }}>
          <p className="pop-kind">{KIND_LABEL[current.kind]}</p>
          <p className="pop-src">{selected.kept ? 'Visible. It will be sent as written.' : `${SOURCE_LABEL[current.source]}. Hidden on this device.`}</p>
          {!selected.kept && peek && (
            <p className="pop-peek">
              <span className="sr-only">Hidden value: </span>
              {current.text}
            </p>
          )}
          <div className="pop-actions">
            {selected.kept ? (
              <button
                type="button"
                className="btn btn-ink"
                onClick={() => {
                  onReseal(current.start)
                  close(true)
                }}
              >
                Black it out again
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-quiet" aria-pressed={peek} onClick={() => setPeek(!peek)}>
                  {peek ? 'Hide' : 'Peek'}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    onUnseal(current.start)
                    close(true)
                  }}
                >
                  Keep visible
                </button>
              </>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => close(true)}>
              Close
            </button>
          </div>
        </div>
      )}

      {pending && (
        <div className="pop pop-select" role="dialog" aria-label="Black out selected text" ref={popRef} style={{ top: pending.top, left: pending.left }}>
          <div className="pop-actions">
            <button type="button" className="btn btn-ink" onClick={confirmPending}>
              Black this out
            </button>
            <label className="pop-kind-select">
              <span className="sr-only">Kind of detail</span>
              <select value={pending.kind} onChange={(e) => setPending({ ...pending, kind: e.target.value as Kind })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
