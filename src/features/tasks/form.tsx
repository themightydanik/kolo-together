import { useRef } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  taskSchema,
  categories,
  difficulties,
  kinds,
  repetitions,
  type TaskInput,
} from './model'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import { Button } from '../../components/ui/button'
import { errorMessage } from '../../lib/errors'
import type { TaskWorkspace } from './api'
export function TaskForm({
  data,
  close,
}: {
  data: TaskWorkspace
  close: () => void
}) {
  const { client, online } = useAuth()
  const cache = useQueryClient()
  const request = useRef({ id: '', payload: '' })
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<TaskInput>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: '',
      description: '',
      kind: 'personal',
      category: 'care',
      difficulty: 'normal',
      due_date: '',
      recurrence: 'once',
    },
  })
  const kind = useWatch({ control, name: 'kind', defaultValue: 'personal' })
  const difficulty = useWatch({
    control,
    name: 'difficulty',
    defaultValue: 'normal',
  })
  const rule = data.rules.find((rule) => rule.difficulty === difficulty)
  const create = useMutation({
    mutationFn: async (values: TaskInput) => {
      const payload = JSON.stringify(values)
      if (!request.current.id) request.current.id = crypto.randomUUID()
      if (request.current.payload && request.current.payload !== payload)
        request.current.id = crypto.randomUUID()
      request.current.payload = payload
      const { data, error } = await client!.rpc('create_task', {
        p_request_id: request.current.id,
        p_title: values.title,
        p_description: values.description,
        p_kind: values.kind,
        p_category: values.category,
        p_difficulty: values.difficulty,
        p_due_date: values.due_date || null,
        p_recurrence: values.recurrence,
      })
      if (error) throw error
      return data
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['task-workspace'] })
      close()
    },
  })
  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((values) => create.mutate(values))}
    >
      <h2 className="text-xl font-semibold">Новое дело</h2>
      <label className="block">
        Название
        <input
          className="field"
          maxLength={100}
          {...register('title')}
          aria-invalid={!!errors.title}
          aria-describedby="task-title-error"
        />
      </label>
      {errors.title && (
        <p id="task-title-error" role="alert">
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
          {Object.entries(kinds).map(([key, value]) => (
            <option
              key={key}
              value={key}
              disabled={key !== 'personal' && !data.hasPartner}
            >
              {value}
            </option>
          ))}
        </select>
      </label>
      {!data.hasPartner && (
        <p className="text-sm text-muted-foreground">
          Партнёр пока не подключён. Личные дела доступны; предложения и
          совместные дела появятся после подключения.
        </p>
      )}
      {kind !== 'personal' && (
        <p className="rounded-xl bg-muted p-3 text-sm">
          Это приглашение, а не обязательство: партнёр сам решит, принять или
          отклонить его.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          Категория
          <select className="field" {...register('category')}>
            {Object.entries(categories).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Сложность
          <select className="field" {...register('difficulty')}>
            {Object.entries(difficulties).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Дата начала / выполнения
          <input className="field" type="date" {...register('due_date')} />
        </label>
        <label>
          Повторение
          <select className="field" {...register('recurrence')}>
            {Object.entries(repetitions).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {errors.due_date && <p role="alert">{errors.due_date.message}</p>}
      <p className="text-sm text-muted-foreground">
        Награда с сервера: {rule?.xp ?? '—'} XP и {rule?.coins ?? '—'} Coins
        исполнителю.
        {kind === 'joint' &&
          ` Дополнительно ${data.settings.together_xp} Together XP после выполнения обоими.`}{' '}
        Coins — игровые очки без денежной стоимости. Календарь повторений: UTC,
        неделя с понедельника. Дата для повторения означает начало; прошлые
        периоды не начисляются.
      </p>
      {create.isError && (
        <p role="alert" className="text-destructive">
          {errorMessage(create.error)}
        </p>
      )}
      <div className="flex gap-3">
        <Button
          disabled={
            create.isPending ||
            !online ||
            (!data.hasPartner && kind !== 'personal')
          }
        >
          {create.isPending ? 'Создаём…' : 'Создать дело'}
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
