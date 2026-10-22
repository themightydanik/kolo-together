export const MAX_INPUT = 10 * 1024 * 1024,
  MAX_PHOTO = 5 * 1024 * 1024
export async function preparePhoto(file: File): Promise<Blob> {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size === 0 ||
    file.size > MAX_INPUT
  )
    throw Error('Обери JPEG, PNG або WebP до 10 МБ.')
  // Image decoding is available in Safari versions which lack createImageBitmap.
  const url = URL.createObjectURL(file)
  const bitmap = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      bitmap.onload = () => resolve()
      bitmap.onerror = () =>
        reject(Error('Не вдалося відкрити фото. Обери інший знімок.'))
      bitmap.src = url
    })
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
  const scale = Math.min(
    1,
    1920 / Math.max(bitmap.naturalWidth, bitmap.naturalHeight),
  )
  try {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(bitmap.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw Error('Не вдалося підготувати фото.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(Error('Не вдалося підготувати фото.'))),
        'image/jpeg',
        0.82,
      ),
    )
    if (blob.size > MAX_PHOTO)
      throw Error('Фото завелике після стиснення. Обери менший знімок.')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}
export async function photoDigest(blob: Blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
    ),
  )
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')
}
