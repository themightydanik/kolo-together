import { z } from 'zod'
import type { Json } from '../../lib/database.types'
export const categories = {
  date: 'Побачення',
  travel: 'Подорож',
  joy: 'Маленька радість',
  milestone: 'Важлива подія',
  other: 'Інше',
}
export type Memory = {
  id: string
  author_id?: string
  title?: string
  event_date?: string
  story?: string
  category?: keyof typeof categories | null
  status: string
  version?: number
}
export type MemoryPhoto = {
  id: string
  position: number | null
  mime: string
  state: string
  bytes: number
}
export type MemoryNote = { user_id: string; body: string; version: number }
export type MemoryDetail = {
  context: string
  memory: Memory
  photos: MemoryPhoto[]
  notes: MemoryNote[]
  source?: { title: string; date: string; path: string } | null
}
export type MemoryCard = {
  id: string
  title: string
  day: string
  category: keyof typeof categories | null
  status: string
  cover: string | null
}
export type MemoryPage = {
  context: string
  items: MemoryCard[]
  next_cursor: string | null
  create_version: number
}
export type MemoryIntent = {
  action: string
  id: string | null
  expected: number
  payload: Record<string, Json | undefined>
  request: string
}
export const memoryError = (e: unknown) => {
  const msg =
    e && typeof e === 'object' && 'message' in e ? String(e.message) : ''
  if (msg === 'partner_required')
    return 'Запроси партнера, щоб почати спільну історію.'
  if (msg === 'memory_changed')
    return 'Спогад уже змінився в іншому вікні. Перевір збережене перед новим редагуванням.'
  if (msg === 'memory_photo_limit')
    return 'Можна зберегти до п’яти фото. Заверши або скасуй попередні завантаження.'
  if (msg === 'memory_unavailable' || msg === 'memory_context_changed')
    return 'Цей спогад більше недоступний у вашому просторі.'
  if (msg === 'memory_source_unavailable')
    return 'Цей момент зараз не можна зберегти. Онови доступні моменти.'
  return 'Не вдалося перевірити збереження. Перевір зв’язок і спробуй ще раз.'
}
export const prettyDate = (day: string) =>
  new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(day + 'T12:00:00Z'))
export const monthLabel = (day: string) =>
  new Intl.DateTimeFormat('uk-UA', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(day + 'T12:00:00Z'))

export const memoryEditorSchema = z.object({
  title: z.string().trim().min(1).max(120),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (value) =>
        value >= '1900-01-01' &&
        value <= '2200-12-31' &&
        Number.isFinite(Date.parse(value)),
    ),
  story: z.string().max(5000),
  category: z.enum(['', 'date', 'travel', 'joy', 'milestone', 'other']),
})
export const memoryNoteSchema = z.object({ body: z.string().max(3000) })

export type MemoryEditorValues = z.infer<typeof memoryEditorSchema>
