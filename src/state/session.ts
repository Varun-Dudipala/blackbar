// Session state for one letter. Lives in memory only: closing the tab forgets it.

import type { Kind, Span } from '../seal/detectors'
import { addUserSpan, removeSpan, type Leak } from '../seal/redact'
import { completeSpans, mergeSpans } from '../seal/modelSpans'
import type { GlanceResult } from '../ai/device'
import type { CloudFailure } from '../ai/cloudErrors'
import type { CloudTask, LanguageCode } from '../ai/prompts'

export interface Letter {
  text: string
  origin: 'paste' | 'sample' | 'image'
  title: string
  sampleId?: string
}

export type Task<T> =
  | { status: 'idle' }
  | { status: 'running'; note?: string }
  | { status: 'done'; value: T }
  | { status: 'error'; message: string; tooLong?: boolean }

export type Side = 'on_device' | 'in_cloud' | 'mock' | 'blocked' | 'failed'

export interface CallRecord {
  id: number
  label: string
  side: Side
  ms?: number
  /** Words that left the device in this call (cloud calls only). */
  wordsSent?: number
  /** The prompt as sent, kept in memory so the receipt can re-check it. */
  sent?: string
}

export interface Answer {
  id: number
  task: CloudTask | 'device'
  language: LanguageCode
  /** Exactly what was sent for a follow-up question (sealed). */
  questionSent?: string
  text: string
  status: 'streaming' | 'done' | 'error' | 'blocked'
  origin: 'cloud' | 'mock' | 'device'
  inferenceSource?: string
  ms?: number
  firstTokenMs?: number | null
  wordsSent?: number
  failure?: CloudFailure
  leaks?: Leak[]
  partial?: boolean
}

export interface Session {
  letter: Letter | null
  spans: Span[]
  /** Stretches the reader unsealed on purpose. They are sent as written. */
  keptVisible: Span[]
  scan: Task<{ added: number; chunks: number }>
  glance: Task<GlanceResult>
  calls: CallRecord[]
  answers: Answer[]
  wordsSent: number
}

export const initialSession: Session = {
  letter: null,
  spans: [],
  keptVisible: [],
  scan: { status: 'idle' },
  glance: { status: 'idle' },
  calls: [],
  answers: [],
  wordsSent: 0,
}

export type Action =
  | { type: 'letter'; letter: Letter; spans: Span[] }
  | { type: 'model-spans'; spans: Span[]; chunks: number }
  | { type: 'scan'; task: Session['scan'] }
  | { type: 'glance'; task: Session['glance'] }
  | { type: 'add-bar'; start: number; end: number; kind?: Kind }
  | { type: 'unseal'; start: number }
  | { type: 'reseal'; start: number }
  | { type: 'call'; call: Omit<CallRecord, 'id'> }
  | { type: 'answer-start'; answer: Omit<Answer, 'text' | 'status'> }
  | { type: 'answer-text'; id: number; text: string }
  | { type: 'answer-end'; id: number; patch: Partial<Answer> }
  | { type: 'reset' }

let nextId = 1
export const newId = () => nextId++

export function reducer(state: Session, action: Action): Session {
  switch (action.type) {
    case 'letter':
      return { ...initialSession, calls: state.calls, wordsSent: state.wordsSent, letter: action.letter, spans: completeSpans(action.letter.text, action.spans) }
    case 'model-spans': {
      const before = state.spans.length
      const spans = completeSpans(state.letter?.text ?? '', mergeSpans(state.spans, action.spans, state.keptVisible), state.keptVisible)
      return { ...state, spans, scan: { status: 'done', value: { added: spans.length - before, chunks: action.chunks } } }
    }
    case 'scan':
      return { ...state, scan: action.task }
    case 'glance':
      return { ...state, glance: action.task }
    case 'add-bar': {
      if (!state.letter) return state
      const withUser = addUserSpan(state.spans, state.letter.text, action.start, action.end, action.kind)
      const added = withUser.find((s) => s.source === 'user' && s.start === Math.min(action.start, action.end))
      // Blacking out a value again overrides an earlier "keep visible" for that value.
      const value = added ? added.text.trim().toLowerCase() : null
      const keptVisible = state.keptVisible.filter((k) => !(added && k.start < added.end && added.start < k.end) && k.text.trim().toLowerCase() !== value)
      return { ...state, spans: completeSpans(state.letter.text, withUser, keptVisible), keptVisible }
    }
    case 'unseal': {
      // Keeping a value visible applies to every place it appears, so the
      // letter never shows a value in one place and hides it in another.
      const span = state.spans.find((s) => s.start === action.start)
      if (!span) return state
      const value = span.text.trim().toLowerCase()
      const same = state.spans.filter((s) => s.text.trim().toLowerCase() === value)
      let spans = state.spans
      for (const s of same) spans = removeSpan(spans, s.start)
      return { ...state, spans, keptVisible: [...state.keptVisible, ...same].sort((a, b) => a.start - b.start) }
    }
    case 'reseal': {
      const span = state.keptVisible.find((s) => s.start === action.start)
      if (!span) return state
      const value = span.text.trim().toLowerCase()
      const same = state.keptVisible.filter((s) => s.text.trim().toLowerCase() === value)
      return {
        ...state,
        keptVisible: state.keptVisible.filter((s) => !same.includes(s)),
        spans: [...state.spans, ...same].sort((a, b) => a.start - b.start),
      }
    }
    case 'call':
      return {
        ...state,
        calls: [...state.calls, { ...action.call, id: newId() }],
        wordsSent: state.wordsSent + (action.call.wordsSent ?? 0),
      }
    case 'answer-start':
      return { ...state, answers: [...state.answers, { ...action.answer, text: '', status: 'streaming' }] }
    case 'answer-text':
      return { ...state, answers: state.answers.map((a) => (a.id === action.id ? { ...a, text: action.text } : a)) }
    case 'answer-end':
      return { ...state, answers: state.answers.map((a) => (a.id === action.id ? { ...a, status: 'done', ...action.patch } : a)) }
    case 'reset':
      return initialSession
  }
}
