// A deliberately small Markdown reader for model answers. It produces plain
// data (never HTML), so model output cannot inject markup into the page.

export type Inline = { type: 'text'; text: string } | { type: 'strong'; text: string } | { type: 'em'; text: string }

export type Block =
  | { type: 'heading'; level: 2 | 3 | 4; inline: Inline[] }
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'rule' }

export interface ListItem {
  inline: Inline[]
  /** null for a plain item, true/false for a "- [x]" / "- [ ]" task item. */
  checked: boolean | null
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  const re = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    if (m[1] !== undefined || m[2] !== undefined) out.push({ type: 'strong', text: m[1] ?? m[2] ?? '' })
    else out.push({ type: 'em', text: m[3] ?? '' })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

const LIST = /^\s*(?:([-*+])|(\d+)[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', inline: parseInline(para.join(' ')) })
    para = []
  }
  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flush()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim())
    if (heading) {
      flush()
      const level = Math.min(4, Math.max(2, heading[1].length + 1)) as 2 | 3 | 4
      blocks.push({ type: 'heading', level, inline: parseInline(heading[2].replace(/#+$/, '').trim()) })
      continue
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flush()
      blocks.push({ type: 'rule' })
      continue
    }
    const item = LIST.exec(line)
    if (item) {
      flush()
      const ordered = item[2] !== undefined
      const checked = item[3] === undefined ? null : item[3].toLowerCase() === 'x'
      const entry: ListItem = { inline: parseInline(item[4]), checked }
      const prev = blocks[blocks.length - 1]
      if (prev && prev.type === 'list' && prev.ordered === ordered) prev.items.push(entry)
      else blocks.push({ type: 'list', ordered, items: [entry] })
      continue
    }
    const prev = blocks[blocks.length - 1]
    if (para.length === 0 && prev?.type === 'list' && /^\s{2,}\S/.test(raw)) {
      // Continuation of the previous list item.
      const last = prev.items[prev.items.length - 1]
      last.inline.push({ type: 'text', text: ' ' }, ...parseInline(line.trim()))
      continue
    }
    para.push(line.trim())
  }
  flush()
  return blocks
}

export type Segment = { type: 'text'; text: string } | { type: 'placeholder'; placeholder: string; kind: string }

/**
 * Splits text into plain text and ⟦KIND_n⟧ placeholders. A placeholder that is
 * still arriving at the end of a stream ("⟦SS") is held back, not shown raw.
 */
export function splitPlaceholders(text: string): Segment[] {
  const out: Segment[] = []
  const re = /⟦([A-Z_]+?)_(\d+)⟧/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    out.push({ type: 'placeholder', placeholder: m[0], kind: m[1] })
    last = m.index + m[0].length
  }
  let tail = text.slice(last)
  const open = tail.lastIndexOf('⟦')
  if (open !== -1 && !tail.slice(open).includes('⟧') && tail.length - open <= 24) tail = tail.slice(0, open)
  if (tail) out.push({ type: 'text', text: tail })
  return out
}
