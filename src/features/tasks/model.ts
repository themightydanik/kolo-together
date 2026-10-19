import { z } from 'zod'
export const taskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, 'Минимум 2 символа')
    .max(100, 'Максимум 100 символов'),
  description: z.string().trim().max(1000, 'Максимум 1000 символов'),
  kind: z.enum(['personal', 'proposal', 'joint']),
  category: z.enum([
    'care',
    'home',
    'communication',
    'time',
    'growth',
    'other',
  ]),
  difficulty: z.enum(['easy', 'normal', 'hard']),
  due_date: z
    .string()
    .refine(
      (value) =>
        !value ||
        (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
          !Number.isNaN(Date.parse(value + 'T00:00:00Z')) &&
          new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value),
      'Введите дату',
    ),
  recurrence: z.enum(['once', 'daily', 'weekly']),
})
export type TaskInput = z.infer<typeof taskSchema>
export const categories = {
  care: 'Забота',
  home: 'Дом',
  communication: 'Общение',
  time: 'Совместное время',
  growth: 'Развитие',
  other: 'Другое',
}
export const difficulties = {
  easy: 'Лёгкое',
  normal: 'Обычное',
  hard: 'Сложное',
}
export const kinds = {
  personal: 'Личное',
  proposal: 'Предложение партнёру',
  joint: 'Совместное',
}
export const repetitions = {
  once: 'Разовое',
  daily: 'Ежедневно',
  weekly: 'Еженедельно',
}
