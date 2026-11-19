// DEV ONLY. A stand-in for the cloud model so the cloud stage can be built
// without quota. Loaded only when import.meta.env.DEV and VITE_MOCK_CLOUD=true;
// production builds never include this file. Every answer it produces is
// labelled "mock cloud response" in the UI.

import type { CloudPayload, CloudSender, CloudStream } from './cloud'

const pick = (prompt: string, kind: string) => new RegExp(`⟦${kind}_\\d+⟧`).exec(prompt)?.[0] ?? `[${kind.toLowerCase()}]`

function answerFor(prompt: string): string {
  const name = pick(prompt, 'NAME')
  const ref = pick(prompt, 'ACCOUNT')
  if (prompt.includes('THE READER ASKS')) {
    return `MOCK CLOUD RESPONSE. The letter does not say this directly. It asks ${name} to respond by the deadline it names, and quotes ${ref} as the reference.`
  }
  if (prompt.includes('checklist')) {
    return `MOCK CLOUD RESPONSE. The deadline is the date printed in the letter.\n\n- [ ] Read the full letter once more\n- [ ] Gather the documents it lists\n- [ ] Write ${ref} on every page you send\n- [ ] Send it before the deadline and keep a copy\n\n### Before you send\n- Check the mailing address on the letter`
  }
  if (prompt.includes('Draft a short')) {
    return `MOCK CLOUD RESPONSE.\n\n**Subject:** Response regarding ${ref}\n\nDear Sir or Madam,\n\nI received your letter and am sending [describe the document you are attaching].\n\nSincerely,\n${name}`
  }
  return `MOCK CLOUD RESPONSE.\n\n### What this is\nA letter asking ${name} to do something by a deadline.\n\n### What it asks\n- Respond by the date in the letter\n- Quote ${ref}\n\nThis is not legal advice.`
}

export const mockCloudSender: CloudSender = async (payload: CloudPayload, signal?: AbortSignal): Promise<CloudStream> => {
  const words = answerFor(payload.prompt).split(/(?<=\s)/)
  async function* chunks() {
    for (let i = 0; i < words.length; i += 3) {
      if (signal?.aborted) return
      await new Promise((r) => setTimeout(r, 40))
      yield words.slice(i, i + 3).join('')
    }
  }
  return { origin: 'mock', chunks: chunks(), done: Promise.resolve({ inferenceSource: 'mock' }) }
}
