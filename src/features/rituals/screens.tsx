import { useState } from 'react'
import { Link } from 'react-router'
import { Coffee, Heart } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { EmptyState, LoadingState } from '../../components/states'
import { errorMessage } from '../../lib/errors'
import {
  useRitualList,
  useRitualAction,
  useRitualHistory,
  useRitualSummary,
} from './api'
import { useRitualIntent } from './intents'
import { RitualRecovery } from './recovery'
import { RitualForm } from './forms'
import {
  scheduleLabel,
  type RitualCardData,
  type RitualTerms,
  type RitualKind,
} from './model'
const labels = {
  activate: 'Новый ритуал',
  edit: 'Новые условия',
  pause: 'Пауза',
  resume: 'Возобновление',
  close: 'Закрытие',
}
const statuses = {
  waiting: 'Ожидает',
  partial: 'Отметил один участник',
  completed: 'Выполнено вместе',
  missed: 'Этот день прошёл',
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
export function RitualCard({
  ritual: r,
  refresh,
  today = false,
}: {
  ritual: RitualCardData
  refresh: () => Promise<unknown>
  today?: boolean
}) {
  const { session, online } = useAuth(),
    action = useRitualAction(r.request_version)
  const intent = useRitualIntent(session!.user.id, `change:${r.id}`)
  const [edit, setEdit] = useState(false),
    [withdraw, setWithdraw] = useState(false)
  const instance = r.instance,
    done = instance?.marks.includes(session!.user.id),
    terms = today && instance ? instance.terms : r.terms
  const pending = r.pending,
    own = pending?.requester_id === session!.user.id
  const change = (kind: RitualKind) =>
    action.mutate({ kind: 'propose', ritual: r.id, change: kind, payload: {} })
  return (
    <Card className="space-y-3 border-primary/15">
      <h3 className="break-words font-semibold">
        {terms.emoji} {terms.title}
      </h3>
      <p className="whitespace-pre-wrap break-words text-sm">
        {terms.description}
      </p>
      <p className="text-xs text-muted-foreground">{scheduleLabel(terms)}</p>
      <p className="text-xs text-muted-foreground">
        Начало действующих условий: {r.starts_on} UTC. Участие добровольно, без
        начислений и обязательств.
      </p>
      {instance && (
        <div className="rounded-2xl bg-primary/5 p-3">
          <p className="text-sm font-medium">
            {statuses[instance.status]} · {instance.scheduled_on} UTC
          </p>
          {instance.status === 'missed' ? (
            <p className="mt-1 text-xs">
              Ничего страшного. Подтверждённые отметки сохранены, штрафов нет.
            </p>
          ) : (
            <p className="mt-1 text-xs">
              {done
                ? 'Ваше участие отмечено.'
                : 'Вы отмечаете только своё участие.'}{' '}
              {instance.status === 'partial'
                ? 'Ждём второго участника без спешки.'
                : instance.status === 'completed'
                  ? 'Спасибо за время вместе.'
                  : ''}
            </p>
          )}
          {r.status === 'active' &&
            !pending &&
            ['waiting', 'partial'].includes(instance.status) &&
            !done && (
              <Button
                className="mt-3"
                disabled={!online || action.isPending}
                onClick={() =>
                  action.mutate({ kind: 'complete', instance: instance.id })
                }
              >
                Отметить своё участие
              </Button>
            )}
        </div>
      )}
      {pending && (
        <section
          className="space-y-3 rounded-2xl border border-border p-3"
          aria-label="Согласование ритуала"
        >
          <h4 className="text-sm font-semibold">
            {labels[pending.kind]} · ждёт согласия
          </h4>
          {(pending.kind === 'edit' || pending.kind === 'activate') && (
            <div className="text-sm">
              <p>
                {(pending.terms as RitualTerms).emoji}{' '}
                {(pending.terms as RitualTerms).title}
              </p>
              <p className="whitespace-pre-wrap">
                {(pending.terms as RitualTerms).description}
              </p>
              <p>{scheduleLabel(pending.terms as RitualTerms)}</p>
            </div>
          )}
          {pending.kind === 'pause' && (
            <p className="text-xs">
              После принятия текущий незавершённый экземпляр остановится.
            </p>
          )}
          {pending.kind === 'resume' && (
            <p className="text-xs">
              После принятия — со следующего дня UTC по расписанию.
            </p>
          )}
          {pending.kind === 'close' && (
            <p className="text-xs">
              Закрытие окончательное. Подтверждённая история останется.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {own
              ? 'Вы предложили — решение за партнёром.'
              : 'Согласие добровольно, отказ не имеет штрафов.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {own ? (
              <Button
                variant="outline"
                disabled={!online || action.isPending}
                onClick={() =>
                  action.mutate({
                    kind: 'resolve',
                    consent: pending.id,
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
                      kind: 'resolve',
                      consent: pending.id,
                      decision: 'accept',
                    })
                  }
                >
                  Принять
                </Button>
                <Button
                  variant="outline"
                  disabled={!online || action.isPending}
                  onClick={() =>
                    action.mutate({
                      kind: 'resolve',
                      consent: pending.id,
                      decision: 'decline',
                    })
                  }
                >
                  Отклонить
                </Button>
              </>
            )}
          </div>
        </section>
      )}
      {intent ? (
        <RitualRecovery
          intent={intent}
          refresh={refresh}
          close={() => setEdit(false)}
        />
      ) : (
        !today &&
        ['active', 'paused'].includes(r.status) &&
        !pending && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!online || action.isPending}
              onClick={() => setEdit(!edit)}
            >
              Предложить изменения
            </Button>
            <Button
              variant="outline"
              disabled={!online || action.isPending}
              onClick={() => change(r.status === 'active' ? 'pause' : 'resume')}
            >
              {r.status === 'active'
                ? 'Предложить паузу'
                : 'Предложить возобновление'}
            </Button>
            <Button
              variant="ghost"
              disabled={!online || action.isPending}
              onClick={() => change('close')}
            >
              Предложить закрытие
            </Button>
          </div>
        )
      )}
      {edit && !intent && (
        <RitualForm
          space={r.space_id}
          expected={r.request_version}
          ritual={r}
          refresh={refresh}
          close={() => setEdit(false)}
        />
      )}
      {!today &&
        ['pending', 'active', 'paused'].includes(r.status) &&
        (withdraw ? (
          <div className="space-y-2">
            <p className="text-sm">
              Прекратить участие сейчас? Будущие экземпляры остановятся без
              согласия партнёра. История и очки сохранятся.
            </p>
            <Button
              variant="outline"
              disabled={!online || action.isPending}
              onClick={() =>
                action.mutate(
                  { kind: 'withdraw', ritual: r.id },
                  { onSuccess: () => setWithdraw(false) },
                )
              }
            >
              Подтвердить отказ от участия
            </Button>
            <Button variant="ghost" onClick={() => setWithdraw(false)}>
              Остаться
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setWithdraw(true)}>
            Отказаться от дальнейшего участия
          </Button>
        ))}
      {action.error && <p role="alert">{errorMessage(action.error)}</p>}
    </Card>
  )
}
export function TodayRituals() {
  const query = useRitualList('today')
  if (query.isPending)
    return (
      <Card>
        <h2 className="font-semibold">Наши ритуалы</h2>
        <LoadingState />
      </Card>
    )
  if (query.isError)
    return <ReadError error={query.error} retry={() => void query.refetch()} />
  const data = query.data.pages[0],
    rituals = query.data.pages.flatMap((p) => p.rituals)
  const refresh = async () => {
    const result = await query.refetch()
    if (result.error) throw result.error
  }
  return (
    <section className="space-y-3" aria-label="Наши ритуалы">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Coffee size={20} aria-hidden="true" />
          Наши ритуалы
        </h2>
        <Link to="/us#rituals" className="text-sm text-primary">
          Управлять
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        Небольшое время вместе, если хочется обоим. Календарь UTC, без XP и
        Coins.
      </p>
      {rituals.length ? (
        rituals.map((r) => (
          <RitualCard key={r.id} ritual={r} refresh={refresh} today />
        ))
      ) : (
        <Card>
          <EmptyState
            title={
              data.partner_connected
                ? 'На сегодня нет ритуалов'
                : 'Ритуалы ждут подключения партнёра'
            }
            description="Предложите подходящую идею в разделе «Мы». Начало — только после согласия обоих."
          />
        </Card>
      )}
    </section>
  )
}
function RitualHistorySection({ context }: { context: string }) {
  const query = useRitualHistory(context),
    summary = useRitualSummary(context),
    cache = useQueryClient()
  const items = query.isError
    ? []
    : (query.data?.pages.flatMap((p) => p.items) ?? [])
  return (
    <Card>
      <h3 className="font-semibold">Время вместе · история ритуалов</h3>
      {summary.isPending ? (
        <LoadingState />
      ) : summary.isError ? (
        <p role="alert">{errorMessage(summary.error)}</p>
      ) : (
        <>
          <p className="my-3 text-sm">
            Выполнено вместе: <strong>{summary.data.completed}</strong>. Только
            доступная история нынешних участников.
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            Последние 30 дней · UTC. Числа — совместные выполнения, без серий и
            оценок.
          </p>
          <ol
            className="mb-5 grid grid-cols-7 gap-2"
            aria-label="Календарь ритуалов UTC"
          >
            {summary.data.calendar.map((d) => (
              <li
                key={d.day}
                className={`rounded-lg p-2 text-center text-xs ${d.completed ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
              >
                <time dateTime={d.day}>{d.day.slice(8)}</time>
                <span className="sr-only"> {d.day} UTC:</span>
                <span className="block">{d.completed}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {query.isPending ? (
        <LoadingState />
      ) : (
        <>
          <ol className="space-y-3">
            {items.map((i) => (
              <li key={i.id} className="rounded-2xl bg-muted/50 p-3 text-sm">
                <p>
                  {i.terms.emoji} {i.terms.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {i.scheduled_on} UTC · {statuses[i.status]} · {i.marks}/2
                </p>
                {i.reason && i.reason !== 'period_ended' && (
                  <p className="text-xs text-muted-foreground">
                    Условия или участие изменились. Отметки сохранены.
                  </p>
                )}
              </li>
            ))}
          </ol>
          {!items.length && !query.isError && (
            <p className="my-4 text-sm text-muted-foreground">
              Здесь появятся завершённые дни. Дни, когда никто не открывал
              приложение, не создаются задним числом.
            </p>
          )}
          {query.isError ? (
            <div role="alert">
              <p>{errorMessage(query.error)}</p>
              <Button
                variant="outline"
                onClick={() =>
                  void cache.resetQueries({ queryKey: ['ritual-history'] })
                }
              >
                Обновить историю с начала
              </Button>
            </div>
          ) : (
            query.hasNextPage && (
              <Button
                variant="outline"
                className="mt-4"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                Ещё 20 дней
              </Button>
            )
          )}
        </>
      )}
    </Card>
  )
}
export function RitualsSection() {
  const [filter, setFilter] = useState('active'),
    [creating, setCreating] = useState(false)
  const query = useRitualList(filter),
    { session } = useAuth()
  const data = query.data?.pages[0],
    scope = `create:${data?.space_id ?? ''}`
  const intent = useRitualIntent(session!.user.id, scope)
  const refresh = async () => {
    const result = await query.refetch()
    if (result.error) throw result.error
  }
  return (
    <section
      id="rituals"
      className="space-y-4 scroll-mt-6"
      aria-label="Управление ритуалами"
    >
      <Card>
        <Heart className="mb-2 text-primary" aria-hidden="true" />
        <h2 className="text-xl font-semibold">Наши ритуалы</h2>
        <p className="my-3 text-sm text-muted-foreground">
          Добровольные встречи в вашем ритме. Любой вправе отказаться без
          штрафа; согласие на прикосновение нужно каждый раз. История с другим
          партнёром скрыта.
        </p>
        {data?.partner_connected ? (
          <Button variant="outline" onClick={() => setCreating(!creating)}>
            {creating ? 'Скрыть форму' : 'Предложить ритуал'}
          </Button>
        ) : (
          <p className="text-sm">
            Для ритуалов нужны два подключённых участника. Ваши остальные
            возможности сохранены.
          </p>
        )}
        {data?.space_id && creating && (
          <div className="mt-5">
            <RitualForm
              space={data.space_id}
              expected={data.create_version}
              refresh={refresh}
              close={() => setCreating(false)}
            />
          </div>
        )}
        {!creating && intent && (
          <RitualRecovery intent={intent} refresh={refresh} />
        )}
      </Card>
      <div
        className="flex gap-2 overflow-x-auto pb-1"
        role="group"
        aria-label="Фильтры ритуалов"
      >
        {[
          ['active', 'Активные'],
          ['pending', 'Ожидают согласования'],
          ['paused', 'На паузе'],
          ['closed', 'Завершённые'],
        ].map(([id, label]) => (
          <Button
            key={id}
            variant={filter === id ? 'default' : 'outline'}
            aria-pressed={filter === id}
            onClick={() => {
              setFilter(id)
              setCreating(false)
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ReadError error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {query.data.pages
            .flatMap((p) => p.rituals)
            .map((r) => (
              <RitualCard key={r.id} ritual={r} refresh={refresh} />
            ))}
          {query.data.pages.every((p) => !p.rituals.length) && (
            <Card>
              <EmptyState
                title="Здесь пока спокойно"
                description="Паузы и отказ — нормальная часть совместных планов. Подберите идею, когда захотите оба."
              />
            </Card>
          )}
          {query.hasNextPage && (
            <Button
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Ещё ритуалы
            </Button>
          )}
          {data && (
            <RitualHistorySection key={data.context} context={data.context} />
          )}
        </>
      )}
    </section>
  )
}
export function DemoRituals() {
  return (
    <Card>
      <h2 className="font-semibold">☕ Наши ритуалы</h2>
      <p className="my-3 text-sm">
        Демонстрационный пример: совместный кофе или чай. Только если хочется
        обоим.
      </p>
      <p className="text-xs text-muted-foreground">
        Серверных согласий и отметок здесь нет. Ритуалы не начисляют XP или
        Coins.
      </p>
    </Card>
  )
}
