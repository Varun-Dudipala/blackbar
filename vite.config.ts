import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { serviceWorker } from './scripts/sw-plugin.ts'

// Development-only switches are blanked in production builds so neither the
// App Check debug token nor the mock cloud can end up in shipped code.
const DEV_ONLY = ['VITE_APPCHECK_DEBUG', 'VITE_APPCHECK_DEBUG_TOKEN', 'VITE_MOCK_CLOUD']

const blankDevOnly = (): Plugin => ({
  name: 'blackbar:blank-dev-only-env',
  apply: 'build',
  config: () => ({
    define: Object.fromEntries(DEV_ONLY.map((k) => [`import.meta.env.${k}`, '""'])),
  }),
})

export default defineConfig({
  plugins: [react(), blankDevOnly(), serviceWorker()],
  server: { host: '127.0.0.1', port: 5183, strictPort: true },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
})
