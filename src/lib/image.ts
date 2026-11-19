import type { ImageInput } from '../ai/device'

const MAX_SIDE = 1600

/** Reads a PNG or JPEG, scales large photos down, and returns base64 for the on-device model. */
export async function fileToImageInput(file: File): Promise<{ image: ImageInput; previewUrl: string }> {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') throw new Error('Choose a PNG or JPEG image. Other formats cannot be read on this device.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const g = canvas.getContext('2d')
  if (!g) throw new Error('This browser could not prepare the image.')
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const mimeType = file.type
  const url = canvas.toDataURL(mimeType, 0.92)
  return { image: { mimeType, data: url.slice(url.indexOf(',') + 1) }, previewUrl: url }
}
