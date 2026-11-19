// On-device inference through Firebase AI Logic (InferenceMode.ONLY_ON_DEVICE).
// These calls never fall back to the cloud: ONLY_ON_DEVICE throws instead, and
// every response is also checked for inferenceSource === "on_device".

import {
  getGenerativeModel,
  InferenceMode,
  type GenerativeModel,
  type LanguageModelCreateOptions,
  type LanguageModelPromptOptions,
  type Part,
} from 'firebase/ai'
import { CLOUD_MODEL, getDeviceAi } from './firebase'
import { GLANCE_SCHEMA, SENSITIVE_SCHEMA } from './schemas'
import { TRANSCRIBE_PROMPT, explainOnDevicePrompt, findSensitivePrompt, glancePrompt } from './prompts'
import { normalizeGlance, parseModelJson, type Glance } from './glance'
import { GLANCE_MAX_CHARS, SEAL_CHUNK_CHARS, chunkText, estimateTokens, ON_DEVICE_TOKEN_LIMIT } from '../lib/chunk'
import { localToday, toIso } from '../lib/dates'
import { mapModelStrings, type ModelItem } from '../seal/modelSpans'
import type { Span } from '../seal/detectors'

// ---------- availability (a capability check, not inference) ----------

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available'
interface LanguageModelStatic {
  availability(options?: LanguageModelCreateOptions): Promise<Availability>
}

const TEXT_OPTIONS: LanguageModelCreateOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
}
const IMAGE_OPTIONS: LanguageModelCreateOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
}

export type DeviceStatus =
  | { state: 'checking' }
  | { state: 'unsupported'; reason: string }
  | { state: 'unavailable'; reason: string }
  | { state: 'downloadable' }
  | { state: 'downloading'; progress: number | null }
  | { state: 'ready'; images: boolean }

const languageModel = (): LanguageModelStatic | undefined =>
  (globalThis as typeof globalThis & { LanguageModel?: LanguageModelStatic }).LanguageModel

export async function checkDevice(): Promise<DeviceStatus> {
  const lm = languageModel()
  if (!lm) {
    return {
      state: 'unsupported',
      reason: 'This browser has no built-in model. On-device reading needs desktop Chrome (version 139 or later) on Windows, macOS 13+, Linux or a Chromebook Plus.',
    }
  }
  try {
    const [text, image] = await Promise.all([lm.availability(TEXT_OPTIONS), lm.availability(IMAGE_OPTIONS).catch(() => 'unavailable' as const)])
    if (text === 'available') return { state: 'ready', images: image === 'available' }
    if (text === 'downloading') return { state: 'downloading', progress: null }
    if (text === 'downloadable') return { state: 'downloadable' }
    return {
      state: 'unavailable',
      reason: 'Chrome says the built-in model cannot run here. It needs about 22 GB of free disk space and either a GPU with more than 4 GB of memory or 16 GB of RAM with 4 or more CPU cores.',
    }
  } catch {
    return { state: 'unavailable', reason: 'Chrome could not report whether the built-in model is available.' }
  }
}

// ---------- models ----------

const ON_DEVICE = (createOptions: LanguageModelCreateOptions, promptOptions?: LanguageModelPromptOptions) => ({
  mode: InferenceMode.ONLY_ON_DEVICE,
  // The SDK requires a cloud model name even in ONLY_ON_DEVICE; it is never called.
  inCloudParams: { model: CLOUD_MODEL },
  onDeviceParams: { createOptions, promptOptions },
})

let warmModel: GenerativeModel | null = null
// The SDK keeps each model's last session open so Chrome keeps the model loaded.
const keepAlive: { model: GenerativeModel | null } = { model: null }

/** Starts (or joins) the model download. Chrome requires this to run from a click. */
export async function prepareDevice(onProgress: (fraction: number) => void): Promise<void> {
  if (!warmModel) warmModel = getGenerativeModel(await getDeviceAi(), ON_DEVICE(TEXT_OPTIONS))
  await warmModel.initializeDeviceModel(onProgress)
}

/**
 * A model instance for one request. Each gets its own AbortSignal so a request
 * that runs too long (the model can loop) is stopped instead of blocking the
 * model for every later request.
 */
async function modelFor(createOptions: LanguageModelCreateOptions, signal: AbortSignal, responseConstraint?: object): Promise<GenerativeModel> {
  const promptOptions: LanguageModelPromptOptions & { signal: AbortSignal } = { signal }
  if (responseConstraint) promptOptions.responseConstraint = responseConstraint
  return getGenerativeModel(await getDeviceAi(), ON_DEVICE({ ...createOptions, signal }, promptOptions))
}

// ---------- errors ----------

export class OnDeviceError extends Error {
  readonly kind: 'too-long' | 'timeout' | 'not-on-device' | 'bad-output' | 'failed'
  constructor(kind: OnDeviceError['kind'], message: string) {
    super(message)
    this.name = 'OnDeviceError'
    this.kind = kind
  }
}

function wrap(e: unknown, timedOut: boolean): OnDeviceError {
  if (e instanceof OnDeviceError) return e
  const name = e instanceof Error ? e.name : ''
  const message = e instanceof Error ? e.message : String(e)
  if (timedOut || name === 'AbortError') return new OnDeviceError('timeout', 'The on-device model took too long and was stopped.')
  if (name === 'QuotaExceededError' || /too large/i.test(message)) {
    return new OnDeviceError('too-long', `This text is too long for the on-device model (its limit is ${ON_DEVICE_TOKEN_LIMIT.toLocaleString()} tokens per request).`)
  }
  return new OnDeviceError('failed', message)
}

export interface OnDeviceCall {
  label: string
  ms: number
  inferenceSource: string
}

interface Job {
  label: string
  options: LanguageModelCreateOptions
  constraint?: object
  request: string | Part[]
  timeoutMs: number
}

async function generate(job: Job): Promise<{ text: string; call: OnDeviceCall }> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, job.timeoutMs)
  const t0 = performance.now()
  try {
    const model = await modelFor(job.options, controller.signal, job.constraint)
    keepAlive.model = model
    const result = await model.generateContent(job.request)
    const source = result.response.inferenceSource ?? 'unknown'
    if (source !== 'on_device') throw new OnDeviceError('not-on-device', `Expected an on-device answer, got "${source}". The result was discarded.`)
    return { text: result.response.text(), call: { label: job.label, ms: Math.round(performance.now() - t0), inferenceSource: source } }
  } catch (e) {
    throw wrap(e, timedOut)
  } finally {
    clearTimeout(timer)
  }
}

const retryable = (e: unknown) => e instanceof OnDeviceError && (e.kind === 'timeout' || e.kind === 'bad-output')

// ---------- features ----------

export interface SensitiveResult {
  spans: Span[]
  calls: OnDeviceCall[]
  chunks: number
}

/** Finds names and other free-form identifiers. Long letters are read in pieces. */
export async function findSensitive(text: string, onProgress?: (done: number, total: number) => void): Promise<SensitiveResult> {
  const chunks = chunkText(text, SEAL_CHUNK_CHARS)
  const items: ModelItem[] = []
  const calls: OnDeviceCall[] = []
  for (let i = 0; i < chunks.length; i++) {
    const { text: out, call } = await generate({
      label: chunks.length > 1 ? `Find identifiers (part ${i + 1} of ${chunks.length})` : 'Find identifiers',
      options: TEXT_OPTIONS,
      constraint: SENSITIVE_SCHEMA,
      request: findSensitivePrompt(chunks[i].text),
      timeoutMs: 60_000,
    })
    calls.push(call)
    const parsed = parseModelJson(out)
    const list = parsed && typeof parsed === 'object' ? (parsed as { items?: unknown }).items : undefined
    if (!Array.isArray(list)) throw new OnDeviceError('bad-output', 'The on-device model returned something that was not a list of identifiers.')
    for (const it of list) {
      if (it && typeof it === 'object' && typeof (it as ModelItem).value === 'string') {
        items.push({ kind: String((it as ModelItem).kind ?? 'OTHER'), value: (it as ModelItem).value })
      }
    }
    onProgress?.(i + 1, chunks.length)
  }
  return { spans: mapModelStrings(text, items), calls, chunks: chunks.length }
}

export interface GlanceResult {
  glance: Glance
  call: OnDeviceCall
  /** True when the letter was longer than one on-device request and only its start was read. */
  partial: boolean
}

export async function readGlance(text: string): Promise<GlanceResult> {
  const partial = text.length > GLANCE_MAX_CHARS
  const input = partial ? chunkText(text, GLANCE_MAX_CHARS)[0].text : text
  const today = localToday()
  const once = async (label: string) => {
    const { text: out, call } = await generate({ label, options: TEXT_OPTIONS, constraint: GLANCE_SCHEMA, request: glancePrompt(input, toIso(today)), timeoutMs: 45_000 })
    const glance = normalizeGlance(parseModelJson(out), text, today)
    if (!glance) throw new OnDeviceError('bad-output', 'The on-device model could not read this letter into a summary.')
    return { glance, call, partial }
  }
  try {
    return await once('At a glance')
  } catch (e) {
    if (!retryable(e)) throw e
    return once('At a glance (second try)')
  }
}

export interface ImageInput {
  mimeType: 'image/png' | 'image/jpeg'
  /** Base64, without the data: prefix. */
  data: string
}

export async function transcribeImage(image: ImageInput): Promise<{ text: string; call: OnDeviceCall }> {
  const { text, call } = await generate({ label: 'Read photo', options: IMAGE_OPTIONS, timeoutMs: 90_000, request: [{ type: 'text', text: TRANSCRIBE_PROMPT }, { type: 'inlineData', inlineData: { mimeType: image.mimeType, data: image.data } }] })
  return { text: text.replace(/^```(?:text)?\s*|\s*```$/g, '').trim(), call }
}

/** A plain explanation from the on-device model. Uses the full letter: nothing leaves the device. */
export async function explainOnDevice(text: string, onText: (soFar: string) => void): Promise<{ text: string; call: OnDeviceCall; partial: boolean }> {
  const partial = text.length > GLANCE_MAX_CHARS
  const input = partial ? chunkText(text, GLANCE_MAX_CHARS)[0].text : text
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 90_000)
  const t0 = performance.now()
  try {
    const model = await modelFor(TEXT_OPTIONS, controller.signal)
    keepAlive.model = model
    const result = await model.generateContentStream(explainOnDevicePrompt(input))
    let out = ''
    for await (const chunk of result.stream) {
      out += chunk.text()
      onText(out)
    }
    const response = await result.response
    const source = response.inferenceSource ?? 'unknown'
    if (source !== 'on_device') throw new OnDeviceError('not-on-device', `Expected an on-device answer, got "${source}".`)
    return { text: out, call: { label: 'Explain on this device', ms: Math.round(performance.now() - t0), inferenceSource: source }, partial }
  } catch (e) {
    throw wrap(e, timedOut)
  } finally {
    clearTimeout(timer)
  }
}

export const tokenEstimate = estimateTokens
