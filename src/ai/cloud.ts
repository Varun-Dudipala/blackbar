// The only way text leaves the device. Every payload passes leakCheck() first;
// if any original value survived sealing, the send is refused before the
// sender is ever called.

import { leakCheck, type Leak, type SealEntry } from '../seal/redact'
import { CLOUD_SYSTEM_INSTRUCTION, buildCloudPrompt, type CloudPromptInput } from './prompts'

export interface CloudPayload {
  systemInstruction: string
  prompt: string
}

export interface CloudStream {
  /** "real" for Gemini through Firebase AI Logic, "mock" for the dev-only stand-in. */
  origin: 'real' | 'mock'
  chunks: AsyncIterable<string>
  /** Resolves when the stream ends, with the side that answered (response.inferenceSource). */
  done: Promise<{ inferenceSource: string | undefined }>
}

export type CloudSender = (payload: CloudPayload, signal?: AbortSignal) => Promise<CloudStream>

export class LeakBlockedError extends Error {
  readonly leaks: Leak[]
  constructor(leaks: Leak[]) {
    super(`Blocked: ${leaks.length} hidden detail${leaks.length === 1 ? '' : 's'} would have been sent.`)
    this.name = 'LeakBlockedError'
    this.leaks = leaks
  }
}

export function buildPayload(input: CloudPromptInput): CloudPayload {
  return { systemInstruction: CLOUD_SYSTEM_INSTRUCTION, prompt: buildCloudPrompt(input) }
}

/** Everything in the payload that would leave the device, as one string. */
export const outboundText = (p: CloudPayload) => `${p.systemInstruction}\n${p.prompt}`

export function gate(payload: CloudPayload, entries: readonly SealEntry[]): Leak[] {
  return leakCheck(outboundText(payload), [...entries])
}

export interface CloudResult {
  text: string
  origin: 'real' | 'mock'
  inferenceSource: string | undefined
  ms: number
  firstTokenMs: number | null
}

/**
 * Runs one cloud request: leak gate, then stream. `onText` receives the whole
 * answer so far after each chunk.
 */
export async function runCloud(
  payload: CloudPayload,
  entries: readonly SealEntry[],
  sender: CloudSender,
  onText: (soFar: string) => void,
  signal?: AbortSignal,
  now: () => number = () => performance.now(),
): Promise<CloudResult> {
  const leaks = gate(payload, entries)
  if (leaks.length > 0) throw new LeakBlockedError(leaks)
  const t0 = now()
  const stream = await sender(payload, signal)
  let text = ''
  let firstTokenMs: number | null = null
  for await (const chunk of stream.chunks) {
    if (signal?.aborted) break
    if (firstTokenMs === null && chunk) firstTokenMs = Math.round(now() - t0)
    text += chunk
    onText(text)
  }
  const { inferenceSource } = await stream.done
  return { text, origin: stream.origin, inferenceSource, ms: Math.round(now() - t0), firstTokenMs }
}
