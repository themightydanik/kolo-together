import { z } from 'zod'
export const rewardCategories = {
  care: 'Забота',
  romance: 'Романтика',
  rest: 'Отдых',
  fun: 'Развлечения',
  time: 'Совместное время',
  other: 'Другое',
}
export const emojis = ['🎁', '☕', '❤️', '🎬', '🌿', '🎲'] as const
export const rewardSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, 'Введите хотя бы 2 символа')
    .max(100, 'Не больше 100 символов'),
  description: z.string().trim().max(1000, 'Не больше 1000 символов'),
  kind: z.enum(['partner', 'joint']),
  category: z.enum(['care', 'romance', 'rest', 'fun', 'time', 'other']),
  emoji: z.enum(emojis),
  price: z
    .number({ message: 'Введите целую стоимость' })
    .int('Стоимость должна быть целой')
    .min(1, 'От 1 Coin')
    .max(100000, 'Не больше 100 000 Coins'),
  single_use: z.boolean(),
})
export type RewardInput = z.infer<typeof rewardSchema>
