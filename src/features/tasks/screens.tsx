import { TodayConnection } from '../connection/screens'
import { TodayRituals } from '../rituals/screens'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Check, Plus, Sparkles } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { CoupleStatus } from '../couple/screens'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { EmptyState, LoadingState } from '../../components/states'
import { errorMessage } from '../../lib/errors'
import type { Task, TaskInstance } from '../../lib/database.types'
import {
  currentInstance,
  useTaskAction,
  useTaskWorkspace,
  type TaskWorkspace,
} from './api'
import { TaskForm } from './form'
import { categories, difficulties, kinds, repetitions } from './model'
const statuses = {
  pending: 'Ожидает принятия',
  active: 'Активно',
  completed: 'Выполнено',
  declined: 'Отклонено',
  cancelled: 'Отменено',
  expired: 'Период завершён',
}
function ReadError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Card>
      <p role="alert">{errorMessage(error)}</p>
      <Button variant="outline" onClick={retry}>
        Повторить
      </Button>
    </Card>
  )
}
export function ProgressCards({ data }: { data: TaskWorkspace }) {
  return (
    <div className="grid grid-cols-3 gap-3" aria-label="Игровой прогресс">
      {[
        [data.xp, 'XP', 'Личный рост'],
        [data.coins, 'Coins', 'Игровые очки'],
        [data.spaceId ? data.togetherXp : '—', 'Together XP', 'Общий путь'],
      ].map(([value, title, description]) => (
        <Card key={title} className="p-3 sm:p-4">
          <Sparkles
            className="mb-2 text-primary"
            size={18}
            aria-hidden="true"
          />
          <p className="text-xs font-semibold">{title}</p>
          <p className="my-2 text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </Card>
      ))}
    </div>
  )
}
export function TaskCard({
  task,
  data,
  instance: given,
  history = false,
}: {
  task: Task
  data: TaskWorkspace
  instance?: TaskInstance
  history?: boolean
}) {
  const { session, online } = useAuth()
  const action = useTaskAction()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const instance = given ?? currentInstance(task, data)
  const participants = data.participants.filter((p) => p.task_id === task.id)
  const me = participants.find((p) => p.user_id === session!.user.id)
  const completed = instance
    ? data.completions.filter((c) => c.instance_id === instance.id)
    : []
  const ownDone = completed.some((c) => c.user_id === session!.user.id)
  const currentReward =
    instance ?? data.rules.find((rule) => rule.difficulty === task.difficulty)
  const status =
    history && instance
      ? instance.status
      : task.recurrence !== 'once' && instance?.status === 'completed'
        ? 'completed'
        : task.status
  const canComplete =
    !history &&
    task.status === 'active' &&
    me?.consent === 'accepted' &&
    instance?.status === 'active' &&
    !ownDone
  const cancellable =
    !history &&
    task.creator_id === session!.user.id &&
    ['active', 'pending'].includes(task.status) &&
    !(instance?.status === 'active' && completed.length > 0)
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-primary">
          {kinds[task.kind]} · {categories[task.category]}
        </span>
        <span className="rounded-full bg-muted px-2 py-1 text-xs">
          {statuses[status]}
        </span>
      </div>
      <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">
        {task.title}
      </h3>
      {task.description && (
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-muted-foreground">
          {task.description}
        </p>
      )}
      <p className="text-sm">
        {difficulties[task.difficulty]} · {currentReward?.xp ?? '—'} XP ·{' '}
        {currentReward?.coins ?? '—'} Coins
      </p>
      <p className="text-xs text-muted-foreground">
        {repetitions[task.recurrence]} ·{' '}
        {task.due_date ? `Дата: ${task.due_date}` : 'Без срока'}
        {instance && task.recurrence !== 'once'
          ? ` · Период с ${instance.period_start}`
          : ''}{' '}
        · UTC
      </p>
      {task.kind === 'joint' && (
        <p
          className="text-sm font-semibold"
          aria-label={`Совместный прогресс ${completed.length} из 2`}
        >
          {completed.length}/2 выполнено · +
          {instance?.together_xp ?? data.settings.together_xp} Together XP после
          обоих
        </p>
      )}
      {ownDone && (
        <p className="flex items-center gap-2 text-sm text-primary">
          <Check size={16} aria-hidden="true" />
          Ваше выполнение учтено сервером
        </p>
      )}
      {!history &&
        task.status === 'pending' &&
        (me?.consent === 'pending' ? (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={action.isPending || !online}
              onClick={() => action.mutate({ kind: 'accept', id: task.id })}
            >
              Принять
            </Button>
            <Button
              variant="outline"
              disabled={action.isPending || !online}
              onClick={() => action.mutate({ kind: 'decline', id: task.id })}
            >
              Отклонить
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ждём решения партнёра. До согласия выполнение недоступно.
          </p>
        ))}
      {canComplete && (
        <Button
          disabled={action.isPending || !online}
          onClick={() => action.mutate({ kind: 'complete', id: instance!.id })}
        >
          {action.isPending ? 'Проверяем…' : 'Отметить своё выполнение'}
        </Button>
      )}
      {!history && task.status === 'active' && !instance && (
        <p className="text-sm text-muted-foreground">
          Начнётся {task.anchor_date} по UTC. До этой даты награды недоступны.
        </p>
      )}
      {cancellable &&
        (confirmCancel ? (
          <div className="space-y-2">
            <p className="text-sm">
              Отменить дело? Начисленные ранее награды останутся в истории.
            </p>
            <Button
              variant="outline"
              disabled={action.isPending || !online}
              onClick={() => action.mutate({ kind: 'cancel', id: task.id })}
            >
              Подтвердить отмену
            </Button>
            <Button
              variant="ghost"
              disabled={action.isPending}
              onClick={() => setConfirmCancel(false)}
            >
              Сохранить дело
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            disabled={action.isPending}
            onClick={() => setConfirmCancel(true)}
          >
            Отменить дело
          </Button>
        ))}
      {action.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(action.error)}
        </p>
      )}
      {action.isSuccess && action.data && (
        <p role="status" className="text-sm">
          {action.data.already_completed
            ? 'Это выполнение уже учтено.'
            : `Сервер подтвердил: +${action.data.xp} XP, +${action.data.coins} Coins${action.data.together_xp ? `, +${action.data.together_xp} Together XP` : ''}.`}
        </p>
      )}
    </Card>
  )
}
export function TasksScreen() {
  const [params] = useSearchParams()
  const query = useTaskWorkspace()
  const { session } = useAuth()
  const [filter, setFilter] = useState('mine')
  const [creating, setCreating] = useState(false)
  const [visible, setVisible] = useState(20)
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return (
      <ReadError
        error={query.error}
        retry={() => {
          void query.refetch()
        }}
      />
    )
  const data = query.data
  if (!data.spaceId) return <CoupleStatus />
  const active = data.tasks.filter((t) =>
    ['pending', 'active'].includes(t.status),
  )
  const tasks = active.filter((t) =>
    filter === 'joint'
      ? t.kind === 'joint'
      : filter === 'partner'
        ? t.kind === 'proposal' && t.creator_id === session!.user.id
        : data.participants.some(
            (p) => p.task_id === t.id && p.user_id === session!.user.id,
          ),
  )
  const linkedInstance = data.instances.find(
    (i) => i.id === params.get('instance') && i.status === 'completed',
  )
  const linkedTask = data.tasks.find((t) => t.id === linkedInstance?.task_id)
  const finished = data.instances.filter((i) => i.status === 'completed')
  const past = data.tasks.filter(
    (t) => t.status === 'declined' || t.status === 'cancelled',
  )
  return (
    <div className="space-y-5">
      {params.has('instance') && (
        <section aria-label="Выполнение из истории">
          <h2 className="mb-3 font-semibold">Выполнение из истории</h2>
          {linkedInstance && linkedTask ? (
            <TaskCard
              task={linkedTask}
              data={data}
              instance={linkedInstance}
              history
            />
          ) : (
            <p>Это выполнение больше недоступно.</p>
          )}
        </section>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Забота без обязательств и штрафов
        </p>
        <Button onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
          <Plus size={18} aria-hidden="true" />
          {creating ? 'Закрыть' : 'Новое дело'}
        </Button>
      </div>
      {!data.hasPartner && (
        <p className="rounded-xl bg-muted p-3 text-sm">
          Партнёр пока не подключён. Личные задания доступны; совместные дела
          ждут второго участника.
        </p>
      )}
      {creating && (
        <Card>
          <TaskForm data={data} close={() => setCreating(false)} />
        </Card>
      )}
      <div
        className="flex gap-2 overflow-x-auto pb-1"
        role="group"
        aria-label="Фильтры заданий"
      >
        {[
          ['mine', 'Мои'],
          ['partner', 'Партнёру'],
          ['joint', 'Совместные'],
          ['done', 'Выполненные'],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={filter === key ? 'default' : 'outline'}
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key)
              setVisible(20)
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {filter === 'done' ? (
        finished.length ? (
          finished.slice(0, visible).map((i) => {
            const task = data.tasks.find((t) => t.id === i.task_id)
            return task ? (
              <TaskCard
                key={i.id}
                task={task}
                data={data}
                instance={i}
                history
              />
            ) : null
          })
        ) : (
          <Card>
            <EmptyState
              title="Первые шаги впереди"
              description="Здесь появятся завершённые экземпляры заданий."
            />
          </Card>
        )
      ) : tasks.length ? (
        tasks
          .slice(0, visible)
          .map((task) => <TaskCard key={task.id} task={task} data={data} />)
      ) : (
        <Card>
          <EmptyState
            title="Здесь пока спокойно"
            description="Создайте личное дело или предложите партнёру что-то приятное."
          />
        </Card>
      )}
      {(filter === 'done' ? finished.length : tasks.length) > visible && (
        <Button variant="outline" onClick={() => setVisible((n) => n + 20)}>
          Показать ещё
        </Button>
      )}
      <Card>
        <h2 className="font-semibold">История ваших выполнений</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Последние 20 начислений; списаний нет. Coins не являются деньгами.
        </p>
        {data.ledger.filter((l) => l.kind === 'personal').length ? (
          <ul className="mt-3 space-y-3">
            {data.ledger
              .filter((l) => l.kind === 'personal')
              .map((l) => (
                <li key={l.id} className="text-sm">
                  <p className="font-semibold [overflow-wrap:anywhere]">
                    {l.title}
                  </p>
                  <p className="text-muted-foreground">
                    +{l.xp} XP · +{l.coins} Coins ·{' '}
                    {new Date(l.created_at).toLocaleString('ru-RU', {
                      timeZone: 'UTC',
                    })}{' '}
                    UTC
                  </p>
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Пока нет начислений.
          </p>
        )}
      </Card>
      {past.length > 0 && (
        <Card>
          <h2 className="font-semibold">Отклонённые и отменённые</h2>
          <ul className="mt-3 space-y-2">
            {past.map((t) => (
              <li key={t.id} className="text-sm [overflow-wrap:anywhere]">
                {t.title} · {statuses[t.status]}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
export function TodayScreen() {
  const query = useTaskWorkspace()
  const { session } = useAuth()
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return (
      <ReadError
        error={query.error}
        retry={() => {
          void query.refetch()
        }}
      />
    )
  const data = query.data
  const pending = data.tasks.filter(
    (t) =>
      t.status === 'pending' &&
      data.participants.some(
        (p) =>
          p.task_id === t.id &&
          p.user_id === session!.user.id &&
          p.consent === 'pending',
      ),
  )
  const today = data.tasks.filter(
    (t) =>
      t.status === 'active' &&
      t.anchor_date <= data.today &&
      data.participants.some(
        (p) => p.task_id === t.id && p.user_id === session!.user.id,
      ) &&
      currentInstance(t, data)?.status === 'active',
  )
  return (
    <div className="space-y-5">
      <Card className="hero">
        <p className="text-sm">
          Рады видеть вас
          {data.profile.display_name ? `, ${data.profile.display_name}` : ''}
        </p>
        <h2 className="mt-3 text-3xl font-semibold">
          Маленькая забота.
          <br />
          Большое «мы».
        </h2>
        <p className="mt-3 text-sm">
          Ваш день: {data.today} · календарь UTC. Без спешки и сравнения.
        </p>
      </Card>
      <ProgressCards data={data} />
      <TodayRituals /><TodayConnection />
      {!data.spaceId && <CoupleStatus />}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Дела на сегодня</h2>
        <Link to="/tasks" className="text-sm text-primary">
          Все дела
        </Link>
      </div>
      {today.length ? (
        today
          .slice(0, 5)
          .map((t) => <TaskCard key={t.id} task={t} data={data} />)
      ) : (
        <Card>
          <EmptyState
            title="Можно выдохнуть"
            description="На сегодня нет активных дел. Новое дело можно создать в разделе «Дела»."
          />
        </Card>
      )}
      <h2 className="font-semibold">Предложения вам</h2>
      {pending.length ? (
        pending.map((t) => <TaskCard key={t.id} task={t} data={data} />)
      ) : (
        <p className="text-sm text-muted-foreground">
          Новых предложений пока нет.
        </p>
      )}
      <Card>
        <h2 className="font-semibold">Последние достижения</h2>
        {data.ledger.length ? (
          <ul className="mt-3 space-y-3">
            {data.ledger.slice(0, 5).map((l) => (
              <li key={l.id} className="text-sm [overflow-wrap:anywhere]">
                {l.title} ·{' '}
                {l.kind === 'together'
                  ? `+${l.together_xp} Together XP`
                  : `+${l.xp} XP, +${l.coins} Coins`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Первые маленькие победы ещё впереди.
          </p>
        )}
      </Card>
    </div>
  )
}
export function TogetherProgress() {
  const query = useTaskWorkspace()
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return (
      <ReadError
        error={query.error}
        retry={() => {
          void query.refetch()
        }}
      />
    )
  return (
    <Card>
      <h2 className="font-semibold">Общий путь</h2>
      <p className="my-3 text-3xl font-semibold text-primary">
        {query.data.spaceId ? query.data.togetherXp : '—'}{' '}
        <span className="text-sm">Together XP</span>
      </p>
      <p className="text-sm text-muted-foreground">
        {query.data.hasPartner
          ? 'Начисляется только после выполнения совместного экземпляра обоими участниками.'
          : 'Партнёр пока не подключён. Личный прогресс доступен, совместные задания ждут второго участника.'}{' '}
        Без рейтинга и сравнения.
      </p>
    </Card>
  )
}
