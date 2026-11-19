// Gemini in the cloud through Firebase AI Logic. ONLY_IN_CLOUD on purpose: the
// payload is sealed text, and on-device answers are offered to the reader as a
// separate, explicit choice that may use the unsealed letter.

import { getGenerativeModel, InferenceMode } from 'firebase/ai'
import { CLOUD_MODEL, getCloudAi } from './firebase'
import type { CloudPayload, CloudSender, CloudStream } from './cloud'

export const firebaseCloudSender: CloudSender = async (payload: CloudPayload): Promise<CloudStream> => {
  const ai = await getCloudAi()
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: CLOUD_MODEL,
      systemInstruction: payload.systemInstruction,
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    },
  })
  const result = await model.generateContentStream(payload.prompt)
  async function* chunks() {
    for await (const chunk of result.stream) yield chunk.text()
  }
  return {
    origin: 'real',
    chunks: chunks(),
    done: result.response.then((r) => ({ inferenceSource: r.inferenceSource })),
  }
}

/** The sender for this build. The mock exists only in dev builds with VITE_MOCK_CLOUD=true. */
export async function getCloudSender(): Promise<CloudSender> {
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK_CLOUD === 'true') {
    const { mockCloudSender } = await import('./mockCloud')
    return mockCloudSender
  }
  return firebaseCloudSender
}

