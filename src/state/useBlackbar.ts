// Orchestrates one session: sealing and glance on-device, cloud requests
// through the leak gate, and the privacy receipt.

import { useCallback, useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import { detect } from '../seal/detectors'
import { leakCheck, sanitizeInput, seal, type Sealed } from '../seal/redact'
import { maskValuesKeepingPlaceholders, sealQuestion } from '../seal/question'
import { wordCount } from '../seal/stats'
import { explainOnDevice, findSensitive, OnDeviceError, readGlance } from '../ai/device'
import { LeakBlockedError, buildPayload, outboundText, runCloud } from '../ai/cloud'
import { classifyCloudError } from '../ai/cloudErrors'
import { getCloudSender } from '../ai/cloudSender'
import { TASK_TITLE, referralFor, type CloudTask, type LanguageCode } from '../ai/prompts'
import { initialSession, newId, reducer, type Letter, type Session } from './session'
import type { DeviceHandle } from './hooks'

export interface Blackbar {
  session: Session
  sealed: Sealed | null
  /** Starts a letter: pattern bars at once, then the on-device model. */
  startLetter: (letter: Letter) => void
  rescan: () => void
  ask: (task: Exclude<CloudTask, 'followup'>, language: LanguageCode) => Promise<void>
  followUp: (question: string, language: LanguageCode) => Promise<void>
  answerOnDevice: () => Promise<void>
  dispatch: React.Dispatch<Parameters<typeof reducer>[1]>
  /** Identifiers that reached the cloud across all sends. Always 0 unless the gate failed. */
  identifiersSent: number
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function useBlackbar(device: DeviceHandle, online: boolean): Blackbar {
  const [session, dispatch] = useReducer(reducer, initialSession)
  const letterRef = useRef<string | null>(null)

  const sealed = useMemo(() => (session.letter ? seal(session.letter.text, session.spans) : null), [session.letter, session.spans])
  const sealedRef = useRef(sealed)
  const answersRef = useRef(session.answers)
  const scanRef = useRef(session.scan.status)
  useLayoutEffect(() => {
    sealedRef.current = sealed
    answersRef.current = session.answers
    scanRef.current = session.scan.status
  }, [sealed, session.answers, session.scan.status])

  const runOnDevice = useCallback(
    async (text: string) => {
      const ready = await device.prepare()
      if (!ready || letterRef.current !== text) return
      dispatch({ type: 'scan', task: { status: 'running' } })
      dispatch({ type: 'glance', task: { status: 'running' } })
      const scan = findSensitive(text)
        .then((r) => {
          if (letterRef.current !== text) return
          for (const call of r.calls) dispatch({ type: 'call', call: { label: call.label, side: 'on_device', ms: call.ms } })
          dispatch({ type: 'model-spans', spans: r.spans, chunks: r.chunks })
        })
        .catch((e: unknown) => {
          if (letterRef.current !== text) return
          dispatch({ type: 'call', call: { label: 'Find identifiers', side: 'failed' } })
          dispatch({ type: 'scan', task: { status: 'error', message: message(e), tooLong: e instanceof OnDeviceError && e.kind === 'too-long' } })
        })
      const glance = readGlance(text)
        .then((r) => {
          if (letterRef.current !== text) return
          dispatch({ type: 'call', call: { label: r.call.label, side: 'on_device', ms: r.call.ms } })
          dispatch({ type: 'glance', task: { status: 'done', value: r } })
        })
        .catch((e: unknown) => {
          if (letterRef.current !== text) return
          dispatch({ type: 'call', call: { label: 'At a glance', side: 'failed' } })
          dispatch({ type: 'glance', task: { status: 'error', message: message(e), tooLong: e instanceof OnDeviceError && e.kind === 'too-long' } })
        })
      await Promise.all([scan, glance])
    },
    [device],
  )

  const startLetter = useCallback(
    (letter: Letter) => {
      const text = sanitizeInput(letter.text.replace(/\r\n/g, '\n')).trim()
      letterRef.current = text
      dispatch({ type: 'letter', letter: { ...letter, text }, spans: detect(text) })
      void runOnDevice(text)
    },
    [runOnDevice],
  )

  const rescan = useCallback(() => {
    if (letterRef.current) void runOnDevice(letterRef.current)
  }, [runOnDevice])

  const send = useCallback(
    async (task: CloudTask, language: LanguageCode, extra?: { question?: string }) => {
      const current = sealedRef.current
      // Nothing is sent while the on-device model is still looking for names.
      if (!current || scanRef.current === 'running') return
      let entries = current.entries
      let questionSent: string | undefined
      if (task === 'followup') {
        const q = sealQuestion(extra?.question ?? '', entries)
        entries = q.entries
        questionSent = q.sealedText
      }
      const previous = [...answersRef.current].reverse().find((a) => a.status === 'done' && a.origin !== 'device')
      const isFirstAnswer = !answersRef.current.some((a) => a.status === 'done' && a.origin !== 'device')
      const payload = buildPayload({
        task,
        sealedLetter: current.sealedText,
        language,
        question: questionSent,
        // Re-mask the earlier answer: the reader may have hidden more since it arrived.
        previousAnswer: task === 'followup' && previous ? maskValuesKeepingPlaceholders(previous.text, entries) : undefined,
        referral: referralFor(task, current.sealedText, isFirstAnswer, questionSent),
      })
      const id = newId()
      dispatch({ type: 'answer-start', answer: { id, task, language, questionSent, origin: 'cloud' } })
      try {
        const sender = await getCloudSender()
        const result = await runCloud(payload, entries, sender, (text) => dispatch({ type: 'answer-text', id, text }))
        // Development only: the dev stand-in makes no request. False in production builds.
        const standIn = import.meta.env.DEV && result.origin === 'mock'
        const words = standIn ? 0 : wordCount(outboundText(payload))
        dispatch({
          type: 'answer-end',
          id,
          patch: { text: result.text, origin: standIn ? 'mock' : 'cloud', inferenceSource: result.inferenceSource, ms: result.ms, firstTokenMs: result.firstTokenMs, wordsSent: words },
        })
        dispatch({ type: 'call', call: { label: TASK_TITLE[task], side: standIn ? 'mock' : result.inferenceSource === 'in_cloud' ? 'in_cloud' : 'failed', ms: result.ms, wordsSent: words, sent: standIn ? undefined : outboundText(payload) } })
      } catch (e) {
        if (e instanceof LeakBlockedError) {
          dispatch({ type: 'answer-end', id, patch: { status: 'blocked', leaks: e.leaks } })
          dispatch({ type: 'call', call: { label: `${TASK_TITLE[task]} (not sent)`, side: 'blocked' } })
          return
        }
        // The request may have reached the server before failing; count its words honestly.
        const failure = classifyCloudError(e, navigator.onLine && online)
        dispatch({ type: 'answer-end', id, patch: { status: 'error', failure } })
        dispatch({
          type: 'call',
          call: { label: `${TASK_TITLE[task]}: ${failure.title.toLowerCase()}`, side: 'failed', wordsSent: failure.kind === 'offline' ? 0 : wordCount(outboundText(payload)), sent: failure.kind === 'offline' ? undefined : outboundText(payload) },
        })
      }
    },
    [online],
  )

  const ask = useCallback((task: Exclude<CloudTask, 'followup'>, language: LanguageCode) => send(task, language), [send])
  const followUp = useCallback((question: string, language: LanguageCode) => send('followup', language, { question }), [send])

  const answerOnDevice = useCallback(async () => {
    const text = letterRef.current
    if (!text) return
    const ready = await device.prepare()
    const id = newId()
    dispatch({ type: 'answer-start', answer: { id, task: 'device', language: 'en', origin: 'device' } })
    if (!ready) {
      dispatch({
        type: 'answer-end',
        id,
        patch: { status: 'error', failure: { kind: 'failed', title: 'The on-device model is not available here', detail: 'This browser cannot run the built-in model, so an on-device answer is not possible.', technical: '' } },
      })
      return
    }
    try {
      const r = await explainOnDevice(text, (soFar) => dispatch({ type: 'answer-text', id, text: soFar }))
      dispatch({ type: 'answer-end', id, patch: { text: r.text, inferenceSource: r.call.inferenceSource, ms: r.call.ms, partial: r.partial } })
      dispatch({ type: 'call', call: { label: r.call.label, side: 'on_device', ms: r.call.ms } })
    } catch (e) {
      dispatch({ type: 'answer-end', id, patch: { status: 'error', failure: { kind: 'failed', title: 'The on-device answer did not finish', detail: message(e), technical: message(e) } } })
      dispatch({ type: 'call', call: { label: 'Explain on this device', side: 'failed' } })
    }
  }, [device])

  const identifiersSent = useMemo(() => {
    const entries = sealed?.entries ?? []
    const leaked = new Set<string>()
    for (const c of session.calls) if (c.sent) for (const l of leakCheck(c.sent, entries)) leaked.add(l.placeholder)
    return leaked.size
  }, [sealed, session.calls])

  return { session, sealed, startLetter, rescan, ask, followUp, answerOnDevice, dispatch, identifiersSent }
}
