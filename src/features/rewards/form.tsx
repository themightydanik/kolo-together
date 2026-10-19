import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import { Button } from '../../components/ui/button'
import { errorMessage } from '../../lib/errors'
import {
  rewardSchema,
  rewardCategories,
  emojis,
  type RewardInput,
} from './model'
export function RewardForm({ close }: { close: () => void }) {
  const { client, online } = useAuth()
  const cache = useQueryClient()
  const request = useRef({ id: '', payload: '' })
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RewardInput>({
    resolver: zodResolver(rewardSchema),
    defaultValues: {
      title: '',
      description: '',
      kind: 'partner',
      category: 'care',
      emoji: '🎁',
      price: 30,
      single_use: false,
    },
  })
  const create = useMutation({
    mutationFn: async (values: RewardInput) => {
      const payload = JSON.stringify(values)
      if (!request.current.id || request.current.payload !== payload)
        request.current.id = crypto.randomUUID()
      request.current.payload = payload
      const result = await client!.rpc('create_reward_offer', {
        p_request_id: request.current.id,
        p_title: values.title,
        p_description: values.description,
        p_kind: values.kind,
        p_category: values.category,
        p_emoji: values.emoji,
        p_price: values.price,
        p_single_use: values.single_use,
      })
      if (result.error) throw result.error
      return result.data
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['reward-store'] })
      close()
    },
  })
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((values) => create.mutate(values))}
    >
      <h2 className="text-xl font-semibold">Новая награда</h2>
      <label className="block">
        Название
        <input
          className="field"
          maxLength={100}
          {...register('title')}
          aria-invalid={!!errors.title}
          aria-describedby="reward-title-error"
        />
      </label>
      {errors.title && (
        <p id="reward-title-error" role="alert">
          {errors.title.message}
        </p>
      )}
      <label className="block">
        Описание
        <textarea
          className="field min-h-24"
          maxLength={1000}
          {...register('description')}
        />
      </label>
      {errors.description && <p role="alert">{errors.description.message}</p>}
      <label className="block">
        Тип
        <select className="field" {...register('kind')}>
          <option value="partner">От меня партнёру</option>
          <option value="joint">Совместная</option>
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          Категория
          <select className="field" {...register('category')}>
            {Object.entries(rewardCategories).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Эмодзи
          <select className="field" {...register('emoji')}>
            {emojis.map((emoji) => (
              <option key={emoji}>{emoji}</option>
            ))}
          </select>
        </label>
        <label>
          Стоимость в Coins
          <input
            className="field"
            type="number"
            min={1}
            max={100000}
            step={1}
            {...register('price', { valueAsNumber: true })}
            aria-invalid={!!errors.price}
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" {...register('single_use')} />
          Однократная награда
        </label>
      </div>
      {errors.price && <p role="alert">{errors.price.message}</p>}
      <p className="rounded-xl bg-muted p-3 text-sm">
        Создавая награду от себя, вы добровольно предлагаете её партнёру.
        Совместная появится в магазине после его согласия. Покупка — приглашение
        договориться, а не долг: каждый может отказаться с возвратом Coins.
        Coins не являются деньгами.
      </p>
      {create.isError && (
        <p role="alert" className="text-destructive">
          {errorMessage(create.error)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={create.isPending || !online}>
          {create.isPending ? 'Сохраняем…' : 'Предложить награду'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={close}
          disabled={create.isPending}
        >
          Отмена
        </Button>
      </div>
    </form>
  )
}
