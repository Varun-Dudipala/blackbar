// Orchestrates one session: sealing and glance on-device, cloud requests
// through the leak gate, and the privacy receipt.

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import { detect } from '../seal/detectors'
import { leakCheck, sanitizeInput, seal, type Sealed } from '../seal/redact'
import { maskValuesKeepingPlaceholders, sealQuestion } from '../seal/question'
import { wordCount } from '../seal/stats'
import { explainOnDevice, findSensitive, OnDeviceError, readGlance, verifyOnDevice } from '../ai/device'
import { checkAnswer } from '../check/run'
import type { SealEntry } from '../seal/redact'
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
  const checkCtl = useRef<AbortController | null>(null)

  const sealed = useMemo(() => (session.letter ? seal(session.letter.text, session.spans) : null), [session.letter, session.spans])
  const sealedRef = useRef(sealed)
  const answersRef = useRef(session.answers)
  const scanRef = useRef(session.scan.status)
  useLayoutEffect(() => {
    sealedRef.current = sealed
    answersRef.current = session.answers
    scanRef.current = session.scan.status
  }, [sealed, session.answers, session.scan.status])

  const deviceReady = device.status.state === 'ready'
  const readyRef = useRef(deviceReady)
  useLayoutEffect(() => {
    readyRef.current = deviceReady
  }, [deviceReady])

  // Runs the on-device scan and glance, but only if the model is already
  // downloaded. It never starts a download: that is the reader's choice.
  const runOnDevice = useCallback(
    async (text: string) => {
      if (!readyRef.current || letterRef.current !== text) return
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
    [],
  )

  // When the model becomes ready (after a download), check the current letter.
  useEffect(() => {
    if (deviceReady && session.letter && session.scan.status === 'idle') void runOnDevice(session.letter.text)
  }, [deviceReady, session.letter, session.scan.status, runOnDevice])

  const startLetter = useCallback(
    (letter: Letter) => {
      const text = sanitizeInput(letter.text.replace(/\r\n/g, '\n')).trim()
      letterRef.current = text
      checkCtl.current?.abort()
      // Pattern checks run at once. The effect above starts the model check when it can.
      dispatch({ type: 'letter', letter: { ...letter, text }, spans: detect(text) })
    },
    [],
  )

  const rescan = useCallback(() => {
    if (letterRef.current) void runOnDevice(letterRef.current)
  }, [runOnDevice])

  // The on-device check of the latest cloud answer. A newer answer, or a new
  // letter, cancels the one in progress.
  const runCheck = useCallback(async (id: number, text: string, entries: readonly SealEntry[]) => {
    const letter = letterRef.current
    if (!letter) return
    checkCtl.current?.abort()
    const ctl = new AbortController()
    checkCtl.current = ctl
    const verifier = readyRef.current ? (prompt: string, schema: object, signal: AbortSignal) => verifyOnDevice(prompt, schema, signal) : null
    dispatch({ type: 'answer-check', id, check: { status: 'running', done: 0, total: 1 } })
    try {
      const result = await checkAnswer(text, entries, letter, verifier, (done, total) => dispatch({ type: 'answer-check', id, check: { status: 'running', done, total } }), ctl.signal)
      if (ctl.signal.aborted) return
      dispatch({ type: 'answer-check', id, check: { status: 'done', result } })
      dispatch({ type: 'call', call: { label: result.mode === 'model' ? 'Check answer against letter' : 'Check numbers against letter', side: 'on_device', ms: result.ms } })
    } catch (e) {
      if (ctl.signal.aborted) {
        dispatch({ type: 'answer-check', id, check: { status: 'cancelled' } })
        return
      }
      dispatch({ type: 'answer-check', id, check: { status: 'error', message: message(e) } })
      dispatch({ type: 'call', call: { label: 'Check answer against letter', side: 'failed' } })
    } finally {
      if (checkCtl.current === ctl) checkCtl.current = null
    }
  }, [])

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
      checkCtl.current?.abort()
      const id = newId()
      // Record whether the on-device model had checked the letter when it was sent.
      const patternsOnly = scanRef.current !== 'done'
      dispatch({ type: 'answer-start', answer: { id, task, language, questionSent, origin: 'cloud', patternsOnly } })
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
        dispatch({ type: 'call', call: { label: TASK_TITLE[task], side: standIn ? 'mock' : result.inferenceSource === 'in_cloud' ? 'in_cloud' : 'failed', ms: result.ms, wordsSent: words, sent: standIn ? undefined : outboundText(payload), patternsOnly } })
        void runCheck(id, result.text, entries)
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
    [online, runCheck],
  )

  const ask = useCallback((task: Exclude<CloudTask, 'followup'>, language: LanguageCode) => send(task, language), [send])
  const followUp = useCallback((question: string, language: LanguageCode) => send('followup', language, { question }), [send])

  const answerOnDevice = useCallback(async () => {
    const text = letterRef.current
    if (!text) return
    const id = newId()
    dispatch({ type: 'answer-start', answer: { id, task: 'device', language: 'en', origin: 'device' } })
    if (!readyRef.current) {
      dispatch({
        type: 'answer-end',
        id,
        patch: {
          status: 'error',
          failure: {
            kind: 'failed',
            title: 'Chrome\'s on-device model is not ready',
            detail: 'An answer on this device needs Chrome\'s built-in model to be downloaded first. Use Download at the top of the page if it is offered.',
            technical: '',
          },
        },
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
  }, [])

  const identifiersSent = useMemo(() => {
    const entries = sealed?.entries ?? []
    const leaked = new Set<string>()
    for (const c of session.calls) if (c.sent) for (const l of leakCheck(c.sent, entries)) leaked.add(l.placeholder)
    return leaked.size
  }, [sealed, session.calls])

  return { session, sealed, startLetter, rescan, ask, followUp, answerOnDevice, dispatch, identifiersSent }
}
