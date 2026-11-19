// Turns cloud failures into calm, specific messages. The letter is never lost
// when a cloud call fails: it stays sealed on the device.

export type CloudFailureKind = 'offline' | 'app-check' | 'quota' | 'not-configured' | 'refused' | 'failed'

export interface CloudFailure {
  kind: CloudFailureKind
  title: string
  detail: string
  /** The raw error message, shown under "Technical details". */
  technical: string
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function classifyCloudError(error: unknown, online: boolean): CloudFailure {
  const technical = messageOf(error)
  const m = technical.toLowerCase()
  if (!online || m.includes('failed to fetch') || m.includes('networkerror') || m.includes('err_internet_disconnected')) {
    return {
      kind: 'offline',
      title: 'No connection to the cloud model',
      detail: 'This device is offline, so nothing was sent. The on-device model can explain the letter instead.',
      technical,
    }
  }
  if (m.includes('app check') || m.includes('appcheck') || m.includes('app-check')) {
    return {
      kind: 'app-check',
      title: 'The cloud model did not accept this request',
      detail: 'Firebase App Check could not verify this copy of Blackbar, so the request was refused before it reached Gemini. The on-device model can still explain the letter.',
      technical,
    }
  }
  if (m.includes('429') || m.includes('quota') || m.includes('resource_exhausted') || m.includes('rate limit')) {
    return {
      kind: 'quota',
      title: 'The cloud model is busy right now',
      detail: 'The free cloud quota is used up for the moment. Try again in a minute, or answer on this device instead.',
      technical,
    }
  }
  if (m.includes('not configured') || m.includes('no-api-key') || m.includes('no-app-id') || m.includes('no-project-id')) {
    return {
      kind: 'not-configured',
      title: 'Cloud answers are not set up in this copy',
      detail: 'This build has no Firebase project configured, so cloud features are off. Sealing and the on-device features still work.',
      technical,
    }
  }
  if (m.includes('safety') || m.includes('blocked') || m.includes('400')) {
    return {
      kind: 'refused',
      title: 'The cloud model could not answer this one',
      detail: 'Gemini declined or could not process the request. Try rephrasing, or answer on this device instead.',
      technical,
    }
  }
  return {
    kind: 'failed',
    title: 'The cloud answer did not come through',
    detail: 'The request failed before the answer was complete. Try again, or answer on this device instead.',
    technical,
  }
}
