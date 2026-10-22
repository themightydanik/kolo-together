export type ActivityKind =
  | 'task_consent'
  | 'task_partial'
  | 'task_done'
  | 'goal_consent'
  | 'goal_done'
  | 'ritual_consent'
  | 'ritual_partial'
  | 'ritual_done'
  | 'connection_invite'
  | 'connection_ready'
  | 'connection_notify'
  | 'reaction'
export type ReactionKind = 'support' | 'sweet' | 'proud' | 'thanks'
export const reactions: { kind: ReactionKind; label: string; emoji: string }[] =
  [
    { kind: 'support', label: 'Підтримую', emoji: '❤️' },
    { kind: 'sweet', label: 'Це мило', emoji: '🥰' },
    { kind: 'proud', label: 'Пишаюся', emoji: '🙌' },
    { kind: 'thanks', label: 'Дякую', emoji: '✨' },
  ]
export type ActivityItem = {
  id: string
  kind: ActivityKind
  source_id: string
  slot: number
  actor_id?: string
  subject?: string | null
  created_at: string
  read_at?: string | null
  can_react?: boolean
  own_reaction?: ReactionKind | null
  reaction?: ReactionKind | null
}
export type ActivitySummary = {
  context: string
  unread: number
  reactions_enabled: boolean
  spotlight: ActivityItem | null
}
export type ActivityPage = {
  context: string
  items: ActivityItem[]
  next_cursor: string | null
}
export const activityText: Record<
  ActivityKind,
  { title: string; description: string; action: string }
> = {
  task_consent: {
    title: 'Нова пропозиція від партнера',
    description: 'Спільне починається зі згоди обох.',
    action: 'Переглянути справу',
  },
  task_partial: {
    title: 'Партнер долучився до спільної справи',
    description: 'Маленький крок, який ви робите разом.',
    action: 'Відкрити справу',
  },
  task_done: {
    title: 'Ви разом завершили справу',
    description: 'Ще один теплий момент у вашій історії.',
    action: 'Переглянути результат',
  },
  goal_consent: {
    title: 'Є пропозиція щодо вашої мрії',
    description: 'Перегляньте її, коли буде зручно.',
    action: 'Переглянути пропозицію',
  },
  goal_done: {
    title: 'Ваша спільна мрія здійснилася',
    description: 'Приємно озирнутися на пройдений шлях.',
    action: 'Відкрити ціль',
  },
  ritual_consent: {
    title: 'Нова пропозиція для вашої традиції',
    description: 'Вирішіть удвох, чи підходить вона вам.',
    action: 'Переглянути традицію',
  },
  ritual_partial: {
    title: 'Партнер долучився до ритуалу',
    description: 'Кожен бере участь у своєму темпі.',
    action: 'Відкрити ритуали',
  },
  ritual_done: {
    title: 'Ви провели цей ритуал разом',
    description: 'Трохи часу лише для вас двох.',
    action: 'Переглянути традиції',
  },
  connection_invite: {
    title: 'Запрошення до розмови',
    description: 'Для вас є спільна гра або опитування.',
    action: 'Переглянути запрошення',
  },
  connection_ready: {
    title: 'Ваша розмова готова до перегляду',
    description: 'Ви обоє завершили участь. Можна повернутися до розмови.',
    action: 'Відкрити розмову',
  },
  connection_notify: {
    title: 'Партнер запрошує до «Між нами»',
    description: 'На тебе чекає ваша спільна картка.',
    action: 'Відкрити картку',
  },
  reaction: {
    title: 'Трохи тепла від партнера',
    description: 'Партнер підтримав ваш спільний момент.',
    action: 'Переглянути',
  },
}
export function activityError(error: unknown) {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : ''
  if (message === 'activity_changed')
    return 'Реакція вже змінилася в іншому вікні. Онови події перед новим вибором.'
  if (
    message === 'activity_unavailable' ||
    message === 'activity_context_changed'
  )
    return 'Ця подія більше недоступна. Онови список.'
  if (message === 'activity_cursor_invalid')
    return 'Онови список, щоб побачити актуальні події.'
  return 'Не вдалося перевірити події. Перевір зв’язок і спробуй ще раз.'
}
export function activityDay(at: string, now = new Date()) {
  const localDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((localDay(now) - localDay(new Date(at))) / 86400000)
  return days === 0 ? 'Сьогодні' : days === 1 ? 'Учора' : 'Раніше'
}
export type ReactionIntent = {
  event: string
  kind: ReactionKind | null
  expected: ReactionKind | null
  request: string
}
