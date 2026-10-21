import { z } from 'zod'
export const emojis = [
  '🌅',
  '📵',
  '💜',
  '🌙',
  '☕',
  '🎁',
  '🌿',
  '🤗',
  '🗓️',
] as const
export const presets = [
  ['🌅', 'Утреннее пожелание', 'Несколько тёплых слов в начале дня.'],
  [
    '📵',
    '10 минут без телефонов',
    'Побыть рядом без отвлечений, если обоим удобно.',
  ],
  [
    '💜',
    'Три вещи, за которые мы благодарны',
    'Поделиться тем, что сегодня порадовало.',
  ],
  ['🌙', 'Вечерний разговор', 'Спокойно поговорить о прошедшем дне.'],
  ['☕', 'Совместный кофе или чай', 'Небольшая пауза вместе.'],
  [
    '🎁',
    'Маленький сюрприз',
    'Добровольный знак внимания без покупок или обязательств.',
  ],
  [
    '🌿',
    'Прогулка вдвоём',
    'Немного времени на свежем воздухе, если хочется обоим.',
  ],
  [
    '🤗',
    'Объятия',
    'Только при явном желании обоих в этот момент. Согласие на ритуал не означает согласия на прикосновение.',
  ],
  [
    '🗓️',
    'Обсуждение планов на завтра',
    'Сверить желания и планы без обязательств.',
  ],
] as const
export const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const ritualSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(2, 'Не менее 2 символов')
      .max(100, 'До 100 символов'),
    description: z.string().trim().max(1000, 'До 1000 символов'),
    emoji: z.enum(emojis),
    cadence: z.enum(['daily', 'weekdays', 'weekly']),
    days: z
      .array(z.number().int().min(1).max(7))
      .min(1, 'Выберите день')
      .max(7),
  })
  .superRefine((v, c) => {
    if (
      new Set(v.days).size !== v.days.length ||
      (v.cadence === 'daily' && v.days.length !== 7) ||
      (v.cadence === 'weekly' && v.days.length !== 1)
    )
      c.addIssue({
        code: 'custom',
        path: ['days'],
        message: 'Проверьте дни расписания',
      })
  })
export type RitualTerms = z.infer<typeof ritualSchema>
export type RitualStatus =
  | 'pending'
  | 'active'
  | 'paused'
  | 'closed'
  | 'declined'
export type RitualKind = 'edit' | 'pause' | 'resume' | 'close'
export type RitualDecision = 'accept' | 'decline' | 'withdraw'
export type Ritual = {
  id: string
  space_id: string
  creator_id: string
  partner_id: string
  request_id: string
  terms: RitualTerms
  status: RitualStatus
  version: number
  starts_on: string
  created_at: string
  closed_at: string | null
}
export type RitualConsent = {
  id: string
  ritual_id: string
  requester_id: string
  request_id: string
  kind: RitualKind | 'activate'
  terms: RitualTerms | Record<string, never>
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'void'
  created_at: string
  responded_at: string | null
}
export type RitualInstance = {
  space_id: string
  id: string
  ritual_id: string
  period_key: string
  scheduled_on: string
  version: number
  terms: RitualTerms
  status: 'waiting' | 'partial' | 'completed' | 'missed'
  reason:
    | 'period_ended'
    | 'edit'
    | 'pause'
    | 'close'
    | 'withdraw'
    | 'departure'
    | null
  created_at: string
  completed_at: string | null
}
export type RitualCardData = Ritual & {
  pending: RitualConsent | null
  request_version: number
  instance: (RitualInstance & { marks: string[] }) | null
}
export type RitualCursor = {
  actor: string
  context: string
  filter: string
  at: string
  id: string
  until: string
}
export type RitualPage = {
  rituals: RitualCardData[]
  next_cursor: RitualCursor | null
  context: string
  today: string
  space_id: string | null
  partner_connected: boolean
  create_version: number
}
export type RitualHistoryCursor = {
  actor: string
  context: string
  day: string
  id: string
  until: string
}
export type RitualHistory = {
  items: (RitualInstance & { marks: number })[]
  next_cursor: RitualHistoryCursor | null
  context: string
}
export type RitualSummary = {
  context: string
  timezone: 'UTC'
  completed: number
  calendar: { day: string; completed: number }[]
}
export const scheduleLabel = (terms: RitualTerms) =>
  terms.cadence === 'daily'
    ? 'Каждый день · UTC'
    : `${terms.cadence === 'weekly' ? 'Раз в неделю' : 'По дням'}: ${[
        ...terms.days,
      ]
        .sort((a, b) => a - b)
        .map((d) => weekdays[d - 1])
        .join(', ')} · UTC`
export const defaultTerms: RitualTerms = {
  title: '',
  description: '',
  emoji: '💜',
  cadence: 'daily',
  days: [1, 2, 3, 4, 5, 6, 7],
}
