// Size limits for the on-device model. Chrome's built-in model accepts 9,216
// tokens per request (prompt, letter and schema together). countTokens() is not
// available on-device, so we estimate: English letters run about 3.8 characters
// per token on this model (measured in the lab).

export const ON_DEVICE_TOKEN_LIMIT = 9216
export const CHARS_PER_TOKEN = 3.8

export const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN)

/** Letter characters per identifier-finding request; leaves room for prompt, schema and output. */
export const SEAL_CHUNK_CHARS = 8000
/** Letter characters the glance and on-device explanation read in one request. */
export const GLANCE_MAX_CHARS = 20000

export interface Chunk {
  start: number
  text: string
}

/**
 * Splits text into pieces of at most `max` characters, preferring to cut at a
 * blank line, then a line break, then a sentence end, then a space. Joining the
 * pieces gives back the original text exactly.
 */
export function chunkText(text: string, max: number): Chunk[] {
  if (max < 1) throw new Error('chunk size must be positive')
  const chunks: Chunk[] = []
  let start = 0
  while (start < text.length) {
    if (text.length - start <= max) {
      chunks.push({ start, text: text.slice(start) })
      break
    }
    const window = text.slice(start, start + max)
    let cut = -1
    for (const sep of ['\n\n', '\n', '. ', ' ']) {
      const at = window.lastIndexOf(sep)
      if (at > max * 0.3) {
        cut = at + sep.length
        break
      }
    }
    if (cut <= 0) cut = max
    chunks.push({ start, text: text.slice(start, start + cut) })
    start += cut
  }
  return chunks
}
