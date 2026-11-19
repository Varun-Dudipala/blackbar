// Firebase app, optional App Check, and the AI Logic entry point.
// Nothing here sends anything until a cloud model is actually called.

import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai'

/** Cloud model for the explain / checklist / draft / follow-up features. */
export const CLOUD_MODEL = 'gemini-3.5-flash-lite'

// Each variable is read by name so the build inlines only these values, never the whole env object.
const config: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId)

export type AppCheckMode = 'recaptcha-enterprise' | 'debug' | 'off'

let appCheckMode: AppCheckMode = 'off'
let pending: Promise<AI> | null = null

export const getAppCheckMode = () => appCheckMode

type DebugGlobal = typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }

async function setUpAppCheck(app: FirebaseApp): Promise<void> {
  const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?.trim()
  // Debug tokens exist only in development. The production build replaces these
  // variables with empty strings (vite.config.ts), so these branches are removed.
  const debugToken = import.meta.env.DEV ? import.meta.env.VITE_APPCHECK_DEBUG_TOKEN?.trim() : ''
  const debugFlag = import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG === 'true'

  if (debugToken || debugFlag) {
    // Development on 127.0.0.1: the reCAPTCHA key only attests on the hosted
    // domains, so use the debug flow. The SDK exchanges the debug token itself and
    // never asks the provider, so a provider that loads no script is enough.
    const appCheck = await import('firebase/app-check')
    ;(self as DebugGlobal).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken || true
    appCheck.initializeAppCheck(app, {
      provider: new appCheck.CustomProvider({
        getToken: () => Promise.reject(new Error('App Check runs in debug mode in development')),
      }),
      isTokenAutoRefreshEnabled: false,
    })
    appCheckMode = 'debug'
    return
  }
  if (!siteKey) return
  const appCheck = await import('firebase/app-check')
  appCheck.initializeAppCheck(app, {
    provider: new appCheck.ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  })
  appCheckMode = 'recaptcha-enterprise'
}

let pendingDevice: Promise<AI> | null = null

/**
 * AI Logic for on-device models. A separate Firebase app without App Check:
 * on-device inference needs no attestation, so reading a letter never loads
 * reCAPTCHA or contacts any server.
 */
export function getDeviceAi(): Promise<AI> {
  if (!pendingDevice) {
    pendingDevice = (async () => {
      if (!firebaseConfigured) throw new Error('Firebase is not configured: copy .env.example to .env.local and fill it in.')
      const app = initializeApp(config, 'blackbar-device')
      return getAI(app, { backend: new GoogleAIBackend() })
    })()
    pendingDevice.catch(() => {
      pendingDevice = null
    })
  }
  return pendingDevice
}

/** AI Logic for the cloud model. App Check, when configured, is set up first, on the first cloud request. */
export function getCloudAi(): Promise<AI> {
  if (!pending) {
    pending = (async () => {
      if (!firebaseConfigured) throw new Error('Firebase is not configured: copy .env.example to .env.local and fill it in.')
      const app = initializeApp(config)
      await setUpAppCheck(app)
      return getAI(app, { backend: new GoogleAIBackend() })
    })()
    pending.catch(() => {
      pending = null
    })
  }
  return pending
}
