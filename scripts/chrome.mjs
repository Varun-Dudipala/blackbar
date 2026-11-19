// Launches real Google Chrome headless with a profile that already holds the
// on-device model. Copied from lab/launch.mjs (see lab/LAB-NOTES.md §2 for why
// each Playwright default switch is removed); the lab folder is not modified.
//
// The profile is app/.e2e-profile, an APFS copy-on-write clone of
// lab/.chrome-profile made on first use, so the 2.5 GB model is reused without
// copying it and without Chrome writing into the lab profile.

import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const PROFILE_DIR = process.env.E2E_PROFILE ?? path.join(here, '..', '.e2e-profile')
const LAB_PROFILE = path.join(here, '..', '..', 'lab', '.chrome-profile')
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const FEATURES = 'AIApiFoundationalModel:model_version/v4,OptimizationGuideManifestBroker,AIPromptAPIMultimodalInput'

// Must match playwright-core 1.65.1's default --disable-features string exactly.
const PW_DISABLED_FEATURES = [
  'AvoidUnnecessaryBeforeUnloadCheckSync', 'DestroyProfileOnBrowserClose', 'HttpsUpgrades',
  'HttpsFirstBalancedModeAutoEnable', 'LensOverlay', 'MediaRouter', 'PaintHolding',
  'ThirdPartyStoragePartitioning', 'AvoidCorsURLLoaderRestartOnRedirect', 'TcpPortRandomizationWin',
  'OptimizationHints', 'NetworkTimeServiceQuerying', 'AimEnabled', 'PreconnectToSearch',
  'msForceBrowserSignIn', 'msEdgeUpdateLaunchServicesPreferredVersion',
]
const IGNORED_DEFAULT_ARGS = [
  '--disable-component-update',
  '--disable-background-networking',
  '--disable-component-extensions-with-background-pages',
  '--disable-field-trial-config',
  `--disable-features=${PW_DISABLED_FEATURES.join(',')}`,
  '--enable-features=CDPScreenshotNewSurface,SkipListAccountsWithoutGaiaCookies',
  '--enable-automation',
  '--disable-extensions',
  '--disable-default-apps',
  '--metrics-recording-only',
  '--disable-sync',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
]
const ARGS = [
  '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,MediaRouter,LensOverlay',
  `--enable-features=${FEATURES}`,
]

export function ensureProfile() {
  if (fs.existsSync(PROFILE_DIR)) return
  if (!fs.existsSync(LAB_PROFILE)) throw new Error(`No Chrome profile with the on-device model at ${LAB_PROFILE}. Run the lab download first.`)
  // -c: clonefile (copy-on-write) on APFS, instant and no extra disk.
  execFileSync('cp', ['-cR', LAB_PROFILE, PROFILE_DIR])
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(path.join(PROFILE_DIR, f), { force: true })
}

/** Headless only: never opens a window or takes focus. */
export async function launch() {
  ensureProfile()
  return chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: CHROME,
    headless: true,
    chromiumSandbox: true,
    ignoreDefaultArgs: IGNORED_DEFAULT_ARGS,
    args: ARGS,
    viewport: { width: 1440, height: 900 },
  })
}
