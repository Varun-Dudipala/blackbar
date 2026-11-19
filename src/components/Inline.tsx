// Renders text that may contain ⟦KIND_n⟧ placeholders. Placeholders appear as
// small bars; with "show my details" on, the real value is put back here, on
// the device, and marked as restored.

import { Fragment } from 'react'
import { splitPlaceholders } from '../lib/markdown'
import type { SealEntry } from '../seal/redact'
import { kindLabelOf } from '../seal/kinds'

export interface Reveal {
  show: boolean
  entries: readonly SealEntry[]
}

export function WithBars({ text, reveal }: { text: string; reveal: Reveal }) {
  return (
    <>
      {splitPlaceholders(text).map((seg, i) => {
        if (seg.type === 'text') return <Fragment key={i}>{seg.text}</Fragment>
        const entry = reveal.entries.find((e) => e.placeholder === seg.placeholder)
        if (reveal.show && entry) {
          return (
            <mark key={i} className="restored" title={`${kindLabelOf(seg.kind)}, restored on this device`}>
              {entry.value}
            </mark>
          )
        }
        return (
          <span key={i} className="chip" role="img" aria-label={`Hidden: ${kindLabelOf(seg.kind)}`} title={seg.placeholder}>
            <span aria-hidden="true">{seg.placeholder.slice(1, -1).replace(/_(\d+)$/, ' $1').replace(/_/g, ' ')}</span>
          </span>
        )
      })}
    </>
  )
}
