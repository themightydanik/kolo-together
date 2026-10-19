import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import { Button } from '../../components/ui/button'
import { errorMessage } from '../../lib/errors'
import type { GoalStep } from '../../lib/database.types'
import { useGoalAction } from './api'
import {
  goalSchema,
  stepSchema,
  goalCategories,
  goalEmojis,
  type GoalInput,
  type StepInput,
} from './model'
export function GoalForm({ close }: { close: () => void }) {
  const { client, online } = useAuth()
  const cache = useQueryClient()
  const request = useRef({ payload: '', id: '' })
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<GoalInput>({
    resolver: zodResolver(goalSchema),
    defaultValues: {
      title: '',
      description: '',
      category: 'travel',
      emoji: '🏔️',
      target_date: '',
    },
  })
  const create = useMutation({
    mutationFn: async (values: GoalInput) => {
      const payload = JSON.stringify(values)
      if (request.current.payload !== payload || !request.current.id)
        request.current = { payload, id: crypto.randomUUID() }
      const result = await client!.rpc('create_couple_goal', {
        p_request_id: request.current.id,
        p_title: values.title,
        p_description: values.description,
        p_category: values.category,
        p_emoji: values.emoji,
        p_target_date: values.target_date || null,
      })
      if (result.error) throw result.error
      return result.data
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['couple-goals'] })
      close()
    },
  })
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((v) => create.mutate(v))}
    >
      <h2 className="text-xl font-semibold">Новая цель</h2>
      <label className="block">
        Название цели
        <input
          className="field"
          maxLength={100}
          {...register('title')}
          aria-invalid={!!errors.title}
        />
      </label>
      {errors.title && <p role="alert">{errors.title.message}</p>}
      <label className="block">
        Описание цели
        <textarea
          className="field min-h-24"
          maxLength={1000}
          {...register('description')}
        />
      </label>
      {errors.description && <p role="alert">{errors.description.message}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          Категория
          <select className="field" {...register('category')}>
            {Object.entries(goalCategories).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Emoji
          <select className="field" {...register('emoji')}>
            {goalEmojis.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        Целевая дата · необязательно
        <input
          className="field"
          type="date"
          min="1900-01-01"
          max="2200-12-31"
          {...register('target_date')}
        />
      </label>
      {errors.target_date && <p role="alert">{errors.target_date.message}</p>}
      <p className="rounded-xl bg-muted p-3 text-sm">
        Это предложение, не обязательство. Цель станет активной после согласия
        партнёра. Сроки без штрафов и гонки; +50 Together XP — только после
        достижения и подтверждения обоими.
      </p>
      {create.isError && <p role="alert">{errorMessage(create.error)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!online || create.isPending}>Предложить цель</Button>
        <Button
          type="button"
          variant="ghost"
          disabled={create.isPending}
          onClick={close}
        >
          Отмена
        </Button>
      </div>
    </form>
  )
}
export function StepForm({
  goal,
  step,
  assignment,
  close,
}: {
  goal: string
  step?: GoalStep
  assignment?: StepInput['assignment']
  close: () => void
}) {
  const { online } = useAuth()
  const action = useGoalAction()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<StepInput>({
    resolver: zodResolver(stepSchema),
    defaultValues: {
      title: step?.title ?? '',
      description: step?.description ?? '',
      assignment: assignment ?? 'both',
    },
  })
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((values) =>
        action.mutate(
          {
            kind: 'propose',
            goal,
            change: step ? 'step_edit' : 'step_add',
            payload: { ...values, ...(step ? { step_id: step.id } : {}) },
          },
          { onSuccess: close },
        ),
      )}
    >
      <h2 className="text-lg font-semibold">
        {step ? 'Предложить изменение шага' : 'Новый шаг'}
      </h2>
      <label className="block">
        Название шага
        <input
          className="field"
          maxLength={100}
          {...register('title')}
          aria-invalid={!!errors.title}
        />
      </label>
      {errors.title && <p role="alert">{errors.title.message}</p>}
      <label className="block">
        Описание шага
        <textarea
          className="field"
          maxLength={1000}
          {...register('description')}
        />
      </label>
      {errors.description && <p role="alert">{errors.description.message}</p>}
      <label className="block">
        Кто участвует
        <select className="field" {...register('assignment')}>
          <option value="me">Я</option>
          <option value="partner">Партнёр</option>
          <option value="both">Оба</option>
        </select>
      </label>
      <p className="text-sm text-muted-foreground">
        Условия и участники изменятся только после согласия второго партнёра.
        Каждый отмечает себя. За отдельные шаги XP и Coins не начисляются.
      </p>
      {action.isError && <p role="alert">{errorMessage(action.error)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!online || action.isPending}>Предложить шаг</Button>
        <Button
          type="button"
          variant="ghost"
          disabled={action.isPending}
          onClick={close}
        >
          Отмена
        </Button>
      </div>
    </form>
  )
}
