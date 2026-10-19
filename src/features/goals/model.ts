import { z } from 'zod'
export const goalCategories = {
  travel: 'Путешествия',
  home: 'Дом',
  relationship: 'Отношения',
  health: 'Здоровье и привычки',
  learning: 'Обучение',
  other: 'Другое',
}
export const goalEmojis = ['🏔️', '🏡', '❤️', '🌿', '📚', '✨'] as const
export const goalStatuses = {
  pending: 'Ожидает согласия',
  active: 'Вместе к цели',
  paused: 'На паузе',
  completed: 'Достигнута',
  closed: 'Закрыта',
  declined: 'Отклонена',
}
export const changeLabels = {
  activate: 'Принять цель',
  step_add: 'Добавить шаг',
  step_edit: 'Изменить шаг',
  reorder: 'Изменить порядок шагов',
  pause: 'Поставить на паузу',
  resume: 'Продолжить путь',
  close: 'Закрыть цель',
  complete: 'Отметить цель достигнутой',
}
export const decisionLabels = {
  pending: 'Ждёт решения',
  accepted: 'Согласовано',
  declined: 'Отклонено',
  withdrawn: 'Отозвано',
  void: 'Аннулировано при выходе',
}
const title = z
  .string()
  .trim()
  .min(2, 'Введите хотя бы 2 символа')
  .max(100, 'Не больше 100 символов')
const description = z.string().trim().max(1000, 'Не больше 1000 символов')
export const goalSchema = z.object({
  title,
  description,
  category: z.enum([
    'travel',
    'home',
    'relationship',
    'health',
    'learning',
    'other',
  ]),
  emoji: z.enum(goalEmojis),
  target_date: z
    .string()
    .refine(
      (v) =>
        !v ||
        (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
          v >= '1900-01-01' &&
          v <= '2200-12-31' &&
          Number.isFinite(Date.parse(v + 'T00:00:00Z')) &&
          new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v),
      'Проверьте дату (1900–2200)',
    ),
})
export const stepSchema = z.object({
  title,
  description,
  assignment: z.enum(['me', 'partner', 'both']),
})
export type GoalInput = z.infer<typeof goalSchema>
export type StepInput = z.infer<typeof stepSchema>
