import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuth } from '../auth/auth-context'
import { Button } from '../../components/ui/button'
import { errorMessage } from '../../lib/errors'
import type { GoalStep } from '../../lib/database.types'
import { useGoalAction, useGoals } from './api'
import { useGoalIntent } from './intents'
import { GoalRecovery } from './recovery'
import {
  goalSchema,
  stepSchema,
  goalCategories,
  goalEmojis,
  type GoalInput,
  type StepInput,
} from './model'
export function GoalForm({ close }: { close: () => void }) {
  const { session, online } = useAuth()
  const workspace = useGoals()
  const space = workspace.data?.couple?.space.id ?? ''
  const create = useGoalAction(workspace.data)
  const pending = useGoalIntent(session!.user.id, `create:${space}`)
  const [duplicate, setDuplicate] = useState<GoalInput | null>(null)
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
  function submit(values: GoalInput, confirmed = false) {
    const matches = workspace.data?.goals.some(
      (g) =>
        g.creator_id === session!.user.id &&
        g.title === values.title &&
        g.description === values.description &&
        g.category === values.category &&
        g.emoji === values.emoji &&
        (g.target_date ?? '') === values.target_date,
    )
    if (matches && !confirmed) {
      setDuplicate(values)
      return
    }
    void create
      .mutateAsync({ kind: 'create', space, values })
      .then(close)
      .catch(() => {})
  }
  if (pending)
    return (
      <GoalRecovery
        intent={pending}
        close={close}
        initialError={create.error}
      />
    )
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((v) => submit(v))}
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
      {duplicate && (
        <div className="space-y-2 rounded-xl bg-muted p-3">
          <p>
            Такая цель уже есть. Проверьте список: это может быть результатом
            прежнего запроса.
          </p>
          <Button
            type="button"
            disabled={!online || create.isPending}
            onClick={() => submit(duplicate, true)}
          >
            Создать отдельную цель с такими условиями
          </Button>
        </div>
      )}
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
  const { online, session } = useAuth()
  const workspace = useGoals()
  const [duplicate, setDuplicate] = useState<StepInput | null>(null)
  const action = useGoalAction(workspace.data)
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
  function submit(values: StepInput, confirmed = false) {
    const me = session!.user.id,
      data = workspace.data
    const matches =
      !step &&
      data?.steps.some((s) => {
        if (
          s.goal_id !== goal ||
          s.title !== values.title ||
          s.description !== values.description
        )
          return false
        const people = data.participants
          .filter((p) => p.step_id === s.id)
          .map((p) => p.user_id)
        return values.assignment === 'both'
          ? people.length === 2
          : people.length === 1 &&
              (values.assignment === 'me' ? people[0] === me : people[0] !== me)
      })
    if (matches && !confirmed) {
      setDuplicate(values)
      return
    }
    void action
      .mutateAsync({
        kind: 'propose',
        goal,
        change: step ? 'step_edit' : 'step_add',
        payload: { ...values, ...(step ? { step_id: step.id } : {}) },
      })
      .then(close)
      .catch(() => {})
  }
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((v) => submit(v))}
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
      {duplicate && (
        <div className="space-y-2 rounded-xl bg-muted p-3">
          <p>
            Такой шаг уже согласован. Проверьте историю прежде, чем предлагать
            ещё один.
          </p>
          <Button
            type="button"
            disabled={!online || action.isPending}
            onClick={() => submit(duplicate, true)}
          >
            Предложить ещё один отдельный шаг
          </Button>
        </div>
      )}
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
