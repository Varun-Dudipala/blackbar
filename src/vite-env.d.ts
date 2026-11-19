/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?: string
  /** Dev only: "true" turns on the App Check debug provider flow (a token is printed by the SDK). */
  readonly VITE_APPCHECK_DEBUG?: string
  /** Dev only: a debug token registered in the Firebase console. Never shipped in a build. */
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string
  /** Dev only: "true" replaces cloud answers with a clearly labelled mock. */
  readonly VITE_MOCK_CLOUD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
