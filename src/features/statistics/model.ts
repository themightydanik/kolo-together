export const catalogue = {
  personal_1: ['🌱', 'Первое доброе дело', '1 собственное выполнение задания'],
  personal_10: ['💜', 'Забота в действии', '10 собственных выполнений заданий'],
  personal_25: ['🌿', 'Маленькие шаги', '25 собственных выполнений заданий'],
  joint_1: [
    '🤝',
    'Первый шаг вместе',
    '1 полностью завершённое совместное задание',
  ],
  joint_5: ['✨', 'Хорошая команда', '5 совместных заданий'],
  joint_10: ['🫶', '10 моментов заботы', '10 совместных заданий'],
  joint_25: ['🌟', 'Вместе сильнее', '25 совместных заданий'],
  goal_1: ['🌈', 'Мечта сбылась', '1 достигнутая цель'],
  goal_3: ['🧭', 'Навстречу мечтам', '3 достигнутые цели'],
  goal_10: ['🏔️', 'Большой путь', '10 достигнутых целей'],
  together_20: ['💫', 'Наш первый опыт', '20 Together XP пространства'],
  together_100: ['☀️', '100 XP навстречу', '100 Together XP пространства'],
  together_500: ['🪐', 'Наш общий путь', '500 Together XP пространства'],
} satisfies Record<string, [string, string, string]>
export type BadgeCode = keyof typeof catalogue
export type Badge = {
  code: BadgeCode
  scope: 'personal' | 'shared' | 'space'
  metric: 'personal' | 'task' | 'goal' | 'xp'
  threshold: number
  progress: number
  unlocked_at: string | null
}
export type Statistics = {
  as_of: string
  timezone: 'UTC'
  context: string
  personal: { xp: number; coins: number; tasks: number; achievements: number }
  shared: {
    together_xp: number
    tasks: number
    goals: number
    achievements: number
    opening_together_xp: number
    xp_series_complete: boolean
  }
  streak: { current: number; best: number }
  activity: { days7: number; days30: number }
  calendar: {
    day: string
    actions: number
    together_xp: number
    cumulative_xp: number
  }[]
  badges: Badge[]
}
export type HistoryCursor = {
  badges: string[]
  session: string
  at: string
  key: string
}
export type HistoryItem = {
  at: string
  key: string
  kind: 'task' | 'goal' | 'reward' | 'achievement'
  object_id: string | null
  title: string
}
export type HistoryPage = {
  context: string
  items: HistoryItem[]
  next_cursor: HistoryCursor | null
}
export const utcDate = (value: string) =>
  new Date(value).toLocaleDateString('ru-RU', { timeZone: 'UTC' })
export function badgeInfo(code: string): [string, string, string] {
  return (
    catalogue[code as BadgeCode] ?? ['✨', 'Достижение', 'Совместный прогресс']
  )
}
export function historyLink(item: HistoryItem) {
  if (!item.object_id) return null
  if (item.kind === 'goal') return `/goals/${item.object_id}`
  if (item.kind === 'task')
    return `/tasks?instance=${encodeURIComponent(item.object_id)}`
  if (item.kind === 'reward')
    return `/rewards?purchase=${encodeURIComponent(item.object_id)}`
  return null
}
