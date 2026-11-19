// TEST DOUBLE SEAM, development builds only.
//
// The e2e script can install `window.__blackbarDeviceSeam` to fake Chrome's
// model availability and download progress, so the "not downloaded →
// downloading NN% → ready" states can be checked on a machine where the model
// is already installed. `import.meta.env.DEV` is false in production builds, so
// this function returns null there and the seam is removed from the bundle.

import type { DeviceStatus } from './device'

export interface DeviceSeam {
  check: () => Promise<DeviceStatus>
  prepare: (onProgress: (fraction: number) => void) => Promise<void>
}

export function deviceSeam(): DeviceSeam | null {
  if (!import.meta.env.DEV) return null
  return (globalThis as typeof globalThis & { __blackbarDeviceSeam?: DeviceSeam }).__blackbarDeviceSeam ?? null
}
