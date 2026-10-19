import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Plus, Sparkles, ArrowLeft, Mountain } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { EmptyState, LoadingState } from '../../components/states'
import { errorMessage } from '../../lib/errors'
import type {
  CoupleGoal,
  GoalConsent,
  GoalStep,
} from '../../lib/database.types'
import { useGoals, useGoalAction, type GoalsWorkspace } from './api'
import { GoalForm, StepForm } from './forms'
import {
  goalCategories,
  goalStatuses,
  changeLabels,
  decisionLabels,
} from './model'
function person(data: GoalsWorkspace, id: string, me: string) {
  return id === me
    ? 'Вы'
    : data.couple?.profiles.find((p) => p.id === id)?.display_name || 'Партнёр'
}
function Progress({ goal, data }: { goal: CoupleGoal; data: GoalsWorkspace }) {
  const progress = data.progress.find((p) => p.goal_id === goal.id)
  return (
    <div className="space-y-2">
      <div className="flex justify-between gap-2 text-sm">
        <span>
          {progress?.completed_steps ?? 0} из {progress?.total_steps ?? 0} шагов
        </span>
        <span>{progress?.percent ?? 0}%</span>
      </div>
      <progress
        className="h-2 w-full accent-primary"
        aria-label={`Прогресс цели ${goal.title}`}
        max={100}
        value={progress?.percent ?? 0}
      />
    </div>
  )
}
function ReadError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Card>
      <p role="alert">{errorMessage(error)}</p>
      <Button onClick={retry}>Повторить</Button>
    </Card>
  )
}
export function GoalCard({
  goal,
  data,
}: {
  goal: CoupleGoal
  data: GoalsWorkspace
}) {
  return (
    <Card className="space-y-3">
      <p className="text-3xl" aria-hidden="true">
        {goal.emoji}
      </p>
      <h2 className="break-words text-lg font-semibold">
        <Link
          className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          to={`/goals/${goal.id}`}
        >
          {goal.title}
        </Link>
      </h2>
      <p className="text-xs text-muted-foreground">
        {goalCategories[goal.category]} · {goalStatuses[goal.status]}
      </p>
      <Progress goal={goal} data={data} />
      {goal.target_date && (
        <p className="text-xs text-muted-foreground">
          Ориентир:{' '}
          {new Date(goal.target_date + 'T00:00:00').toLocaleDateString('ru-RU')}{' '}
          · без штрафов
        </p>
      )}
      <Button variant="outline" asChild>
        <Link to={`/goals/${goal.id}`}>Открыть цель</Link>
      </Button>
    </Card>
  )
}
export function GoalsScreen() {
  const query = useGoals()
  const [create, setCreate] = useState(false)
  const [filter, setFilter] = useState('active')
  const [visible, setVisible] = useState(20)
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return <ReadError error={query.error} retry={() => void query.refetch()} />
  const data = query.data,
    hasPartner = data.couple?.members.length === 2
  const goals = data.goals.filter((g) =>
    filter === 'history'
      ? ['completed', 'closed', 'declined'].includes(g.status)
      : g.status === filter,
  )
  return (
    <div className="space-y-5">
      <Card>
        <Mountain className="mb-3 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Мечты, к которым идём вместе</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Небольшие согласованные шаги без гонки и штрафов. Достижение
          подтверждаете оба — +50 Together XP на ваш общий путь.
        </p>
      </Card>
      {!hasPartner && (
        <Card>
          <EmptyState
            title="Мечтам нужен второй участник"
            description="Ваше пространство и игровой прогресс сохраняются. Пригласите партнёра, чтобы предлагать общие цели."
          />
          <Button asChild>
            <Link to={data.couple ? '/space/invite' : '/space/create'}>
              {data.couple ? 'Пригласить партнёра' : 'Создать пространство'}
            </Link>
          </Button>
        </Card>
      )}
      <Button disabled={!hasPartner} onClick={() => setCreate(!create)}>
        <Plus size={18} aria-hidden="true" />
        Новая цель
      </Button>
      {create && hasPartner && (
        <Card>
          <GoalForm close={() => setCreate(false)} />
        </Card>
      )}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Фильтры целей"
      >
        {[
          ['active', 'Активные'],
          ['pending', 'Предложения'],
          ['paused', 'На паузе'],
          ['history', 'Завершённые и закрытые'],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={key === filter ? 'default' : 'outline'}
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key)
              setVisible(20)
            }}
          >
            {label}
            {key === 'pending' && data.goals.some((g) => g.status === 'pending')
              ? ` · ${data.goals.filter((g) => g.status === 'pending').length}`
              : ''}
          </Button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {goals.slice(0, visible).map((goal) => (
          <GoalCard key={goal.id} goal={goal} data={data} />
        ))}
      </div>
      {!goals.length && (
        <Card>
          <EmptyState
            title="Здесь появятся ваши цели"
            description="Предложите то, о чём хочется мечтать вдвоём. Второй участник решит, присоединиться ли."
          />
        </Card>
      )}
      {goals.length > visible && (
        <Button variant="outline" onClick={() => setVisible(visible + 20)}>
          Ещё цели
        </Button>
      )}
    </div>
  )
}
export function ConsentCard({
  consent: c,
  data,
}: {
  consent: GoalConsent
  data: GoalsWorkspace
}) {
  const { session, online } = useAuth()
  const action = useGoalAction()
  const me = session!.user.id
  const other = data.goals.find((g) => g.id === c.goal_id)
  const assignment =
    c.payload.assignment === 'both'
      ? 'Оба'
      : c.payload.assignment === 'me'
        ? person(data, c.requester_id, me)
        : other
          ? person(
              data,
              c.requester_id === other.creator_id
                ? other.partner_id
                : other.creator_id,
              me,
            )
          : 'Партнёр'
  return (
    <Card className="space-y-3 border-primary/30">
      <h2 className="font-semibold">На согласовании: {changeLabels[c.kind]}</h2>
      <p className="text-sm">Предлагает: {person(data, c.requester_id, me)}</p>
      {c.payload.title && (
        <div className="rounded-xl bg-muted p-3">
          <p className="break-words font-medium">{c.payload.title}</p>
          {c.payload.description && (
            <p className="whitespace-pre-wrap break-words text-sm">
              {c.payload.description}
            </p>
          )}
          <p className="mt-2 text-sm">Участвует: {assignment}</p>
        </div>
      )}
      {c.payload.step_ids && (
        <ol className="list-inside list-decimal text-sm">
          {c.payload.step_ids.map((id) => (
            <li key={id}>
              {data.steps.find((s) => s.id === id)?.title ?? 'Шаг'}
            </li>
          ))}
        </ol>
      )}
      {c.kind === 'complete' && (
        <p className="text-sm">
          Подтверждая, вы оба отмечаете достигнутую цель. Сервер добавит ровно
          50 Together XP; цель станет доступна только для чтения.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Пока решение ожидается, новые изменения и отметки шагов приостановлены.
        Можно отклонить без штрафа.
      </p>
      <div className="flex flex-wrap gap-2">
        {c.requester_id === me ? (
          <Button
            variant="outline"
            disabled={!online || action.isPending}
            onClick={() =>
              action.mutate({
                kind: 'decide',
                consent: c.id,
                decision: 'withdraw',
              })
            }
          >
            Отозвать предложение
          </Button>
        ) : (
          <>
            <Button
              disabled={!online || action.isPending}
              onClick={() =>
                action.mutate({
                  kind: 'decide',
                  consent: c.id,
                  decision: 'accept',
                })
              }
            >
              Согласен(на)
            </Button>
            <Button
              variant="outline"
              disabled={!online || action.isPending}
              onClick={() =>
                action.mutate({
                  kind: 'decide',
                  consent: c.id,
                  decision: 'decline',
                })
              }
            >
              Отклонить
            </Button>
          </>
        )}
      </div>
      {action.isError && <p role="alert">{errorMessage(action.error)}</p>}
    </Card>
  )
}
export function GoalStepCard({
  step,
  data,
  locked,
  edit,
}: {
  step: GoalStep
  data: GoalsWorkspace
  locked: boolean
  edit: () => void
}) {
  const { session, online } = useAuth()
  const action = useGoalAction()
  const me = session!.user.id
  const participants = data.participants.filter((p) => p.step_id === step.id),
    done = data.completions.filter((c) => c.step_id === step.id)
  const assigned = participants.some((p) => p.user_id === me),
    ownDone = done.some((p) => p.user_id === me)
  return (
    <Card className="space-y-3">
      <h3 className="break-words font-semibold">
        {step.position}. {step.title}
      </h3>
      {step.description && (
        <p className="whitespace-pre-wrap break-words text-sm">
          {step.description}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {participants.map((p) => person(data, p.user_id, me)).join(' + ')} ·{' '}
        {done.length}/{participants.length} ·{' '}
        {step.status === 'completed' ? 'Шаг завершён' : 'В процессе'}
      </p>
      {assigned && !ownDone && step.status === 'active' && (
        <Button
          disabled={locked || !online || action.isPending}
          onClick={() =>
            action.mutate({ kind: 'complete-step', step: step.id })
          }
        >
          Я выполнил(а) шаг
        </Button>
      )}
      {ownDone && (
        <p className="text-sm text-primary">
          Ваша отметка сохранена
          {step.status === 'active' ? ' · ждём партнёра' : ''}.
        </p>
      )}
      {!done.length && step.status === 'active' && (
        <Button
          variant="ghost"
          disabled={locked || !online || action.isPending}
          onClick={edit}
        >
          Изменить по согласию
        </Button>
      )}
      {action.isError && <p role="alert">{errorMessage(action.error)}</p>}
    </Card>
  )
}
export function GoalDetailScreen() {
  const { goalId } = useParams()
  const query = useGoals()
  const { online, session } = useAuth()
  const action = useGoalAction()
  const [editing, setEditing] = useState<GoalStep | 'new' | null>(null),
    [history, setHistory] = useState(20)
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return <ReadError error={query.error} retry={() => void query.refetch()} />
  const data = query.data,
    g = data.goals.find((g) => g.id === goalId)
  if (!g)
    return (
      <Card>
        <EmptyState
          title="Цель недоступна"
          description="Возможно, она относится к другому пространству. Вернитесь к своим целям."
        />
        <Button asChild>
          <Link to="/goals">К целям</Link>
        </Button>
      </Card>
    )
  const pending = data.consents.find(
      (c) => c.goal_id === g.id && c.status === 'pending',
    ),
    steps = data.steps
      .filter((s) => s.goal_id === g.id)
      .sort((a, b) => a.position - b.position)
  const canChange = g.status === 'active' && !pending,
    terminal = ['completed', 'closed', 'declined'].includes(g.status)
  const ready = steps.length > 0 && steps.every((s) => s.status === 'completed')
  const goalEvents = data.events.filter((e) => e.goal_id === g.id)
  function reorder(index: number, delta: number) {
    const ids = steps.map((s) => s.id)
    ;[ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]
    action.mutate({
      kind: 'propose',
      goal: g!.id,
      change: 'reorder',
      payload: { step_ids: ids },
    })
  }
  const editParticipants =
    editing && editing !== 'new'
      ? data.participants.filter((p) => p.step_id === editing.id)
      : []
  const assignment =
    editParticipants.length === 2
      ? 'both'
      : editParticipants[0]?.user_id === session!.user.id
        ? 'me'
        : 'partner'
  return (
    <div className="space-y-5">
      <Button variant="ghost" asChild>
        <Link to="/goals">
          <ArrowLeft size={18} aria-hidden="true" />
          Все цели
        </Link>
      </Button>
      <Card className="space-y-3">
        <h2 className="break-words text-xl font-semibold">
          {g.emoji} {g.title}
        </h2>
        <p className="text-sm text-muted-foreground">
          {goalCategories[g.category]} · {goalStatuses[g.status]}
        </p>
        {g.description && (
          <p className="whitespace-pre-wrap break-words">{g.description}</p>
        )}
        <Progress goal={g} data={data} />
        {g.target_date && (
          <p className="text-sm">
            Целевая дата:{' '}
            {new Date(g.target_date + 'T00:00:00').toLocaleDateString('ru-RU')}{' '}
            · без штрафов за сроки.
          </p>
        )}
      </Card>
      {g.status === 'completed' && (
        <Card>
          <Sparkles className="mb-3 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Вы сделали это вместе!</h2>
          <p className="mt-2 text-sm">
            Цель достигнута
            {g.completed_at
              ? ` ${new Date(g.completed_at).toLocaleDateString('ru-RU')}`
              : ''}
            . +50 Together XP уже добавлены сервером. Теперь здесь хранится ваша
            история.
          </p>
        </Card>
      )}
      {pending && !terminal && <ConsentCard consent={pending} data={data} />}
      {editing && canChange && (
        <Card>
          <StepForm
            key={editing === 'new' ? 'new' : editing.id}
            goal={g.id}
            step={editing === 'new' ? undefined : editing}
            assignment={editing === 'new' ? 'both' : assignment}
            close={() => setEditing(null)}
          />
        </Card>
      )}
      <section className="space-y-3" aria-label="Шаги цели">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Маленькие шаги</h2>
          {!terminal && g.status !== 'pending' && (
            <Button
              disabled={
                !canChange || !online || action.isPending || steps.length >= 100
              }
              onClick={() => setEditing('new')}
            >
              <Plus size={18} aria-hidden="true" />
              Добавить шаг
            </Button>
          )}
        </div>
        {!steps.length && (
          <Card>
            <EmptyState
              title="Первый шаг ещё впереди"
              description="Согласуйте конкретные шаги. Пока их нет, прогресс равен 0%; завершить пустую цель нельзя."
            />
          </Card>
        )}
        {steps.map((s, i) => (
          <div className="space-y-2" key={s.id}>
            <GoalStepCard
              step={s}
              data={data}
              locked={!canChange || action.isPending}
              edit={() => setEditing(s)}
            />
            {canChange && steps.length > 1 && (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  aria-label={`Поднять шаг ${s.title}`}
                  disabled={!online || action.isPending || i === 0}
                  onClick={() => reorder(i, -1)}
                >
                  Выше
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Опустить шаг ${s.title}`}
                  disabled={
                    !online || action.isPending || i === steps.length - 1
                  }
                  onClick={() => reorder(i, 1)}
                >
                  Ниже
                </Button>
              </div>
            )}
          </div>
        ))}
      </section>
      {!terminal && g.status !== 'pending' && (
        <Card className="space-y-3">
          <h2 className="font-semibold">Договориться о цели</h2>
          <div className="flex flex-wrap gap-2">
            {g.status === 'active' && (
              <Button
                disabled={!online || !canChange || !ready || action.isPending}
                onClick={() =>
                  action.mutate({
                    kind: 'propose',
                    goal: g.id,
                    change: 'complete',
                    payload: {},
                  })
                }
              >
                Предложить завершение
              </Button>
            )}
            <Button
              variant="outline"
              disabled={!online || !!pending || action.isPending}
              onClick={() =>
                action.mutate({
                  kind: 'propose',
                  goal: g.id,
                  change: g.status === 'paused' ? 'resume' : 'pause',
                  payload: {},
                })
              }
            >
              {g.status === 'paused'
                ? 'Предложить продолжить'
                : 'Предложить паузу'}
            </Button>
            <Button
              variant="ghost"
              disabled={!online || !!pending || action.isPending}
              onClick={() =>
                action.mutate({
                  kind: 'propose',
                  goal: g.id,
                  change: 'close',
                  payload: {},
                })
              }
            >
              Предложить закрыть
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Любое решение принимаете вдвоём. За шаги нет личных XP и Coins; за
            достижение — один общий бонус.
          </p>
        </Card>
      )}
      {action.isError && <p role="alert">{errorMessage(action.error)}</p>}
      <Card>
        <h2 className="mb-3 font-semibold">Ваш путь</h2>
        <ol className="space-y-3">
          {goalEvents.slice(0, history).map((e) => (
            <li key={e.id} className="text-sm">
              <p>
                {e.kind === 'proposed'
                  ? 'Предложена цель'
                  : e.kind === 'closed_on_departure'
                    ? 'Закрыта при выходе из пары'
                    : e.kind === 'step_completed'
                      ? `Отмечен шаг: ${e.details.title ?? 'Шаг'}`
                      : e.kind === 'change_proposed'
                        ? `Предложено: ${e.details.kind ? changeLabels[e.details.kind] : 'изменение'}`
                        : `${e.kind === 'change_accepted' ? 'Согласовано' : e.kind === 'change_declined' ? 'Отклонено' : 'Отозвано'}: ${e.details.kind ? changeLabels[e.details.kind] : 'изменение'}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {e.actor_id
                  ? person(data, e.actor_id, session!.user.id)
                  : 'Участник'}{' '}
                · {new Date(e.created_at).toLocaleString('ru-RU')}
              </p>
            </li>
          ))}
        </ol>
        {goalEvents.length > history && (
          <Button variant="ghost" onClick={() => setHistory(history + 20)}>
            Ещё события
          </Button>
        )}
      </Card>
      <details className="rounded-xl border border-border p-4 text-sm">
        <summary className="cursor-pointer font-medium">
          История согласований
        </summary>
        <ul className="mt-3 space-y-2">
          {data.consents
            .filter((c) => c.goal_id === g.id && c.status !== 'pending')
            .map((c) => (
              <li key={c.id}>
                {changeLabels[c.kind]} · {decisionLabels[c.status]}
                {c.payload.title ? ` · ${c.payload.title}` : ''}
              </li>
            ))}
        </ul>
      </details>
    </div>
  )
}
export function DemoGoals() {
  return (
    <Card className="space-y-4">
      <Mountain className="text-primary" aria-hidden="true" />
      <h2 className="text-lg font-semibold">О чём мечтаете вдвоём?</h2>
      <p className="text-sm text-muted-foreground">
        Пример · деморежим. Сессии, согласия и серверные награды не создаются.
      </p>
      <h3 className="font-semibold">🏔️ Съездить вместе в Карпаты</h3>
      <p className="text-sm">
        Выбрать даты · найти жильё · продумать маршрут. Пустая цель начинается с
        0%, движение — только по согласию.
      </p>
      <Button disabled>Предложение цели отключено в деморежиме</Button>
    </Card>
  )
}
