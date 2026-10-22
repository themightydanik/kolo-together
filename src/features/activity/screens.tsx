import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Bell, Check, Heart, ArrowRight, WifiOff } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import { PageHeader, OverflowMenu } from '../../components/experience'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import {
  activityText,
  activityDay,
  activityError,
  reactions,
  type ActivityItem,
  type ReactionIntent,
  type ReactionKind,
} from './model'
import {
  useActivityContext,
  useActivityPages,
  useActivitySummary,
  useActivityWrite,
} from './api'

export function ActivityBell() {
  const { client, session } = useAuth()
  return !client ? <BellLink unread={0} /> : session ? <LiveBell /> : null
}
function BellLink({ unread }: { unread: number }) {
  return (
    <Link
      to="/activity"
      className="activity-bell icon-button"
      aria-label={
        unread
          ? `Події пари: ${unread >= 100 ? '99+' : unread} непрочитаних`
          : 'Події пари'
      }
    >
      <Bell size={21} aria-hidden="true" />
      {unread > 0 && (
        <span className="activity-badge" aria-hidden="true">
          {unread >= 100 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
function LiveBell() {
  const { enabled } = useActivityContext(),
    q = useActivitySummary()
  return (
    <BellLink
      unread={
        enabled && !q.isError && !q.isFetching ? (q.data?.unread ?? 0) : 0
      }
    />
  )
}
export function ActivityScreen() {
  const { client } = useAuth()
  return client ? <LiveActivity /> : <DemoActivity />
}
function DemoActivity() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Ваш простір для двох"
        title="Події пари"
        back="/"
        description="Теплі моменти та важливі запрошення — в одному місці."
      />
      <Card className="activity-empty">
        <div className="activity-empty-icon">
          <Bell size={32} />
        </div>
        <h2>Тут з’являться ваші спільні моменти</h2>
        <p>
          Запрошення, завершені справи й підтримка партнера. У демо ми не
          надсилаємо і не зберігаємо події.
        </p>
        <Link className="text-primary underline" to="/us">
          До нашого простору
        </Link>
      </Card>
    </div>
  )
}
function ActivityProblem({
  error,
  retry,
}: {
  error?: unknown
  retry: () => void
}) {
  return (
    <Card>
      <p role="alert">{activityError(error)}</p>
      <Button className="mt-3" variant="outline" onClick={retry}>
        Оновити події
      </Button>
    </Card>
  )
}
function LiveActivity() {
  const ctx = useActivityContext(),
    pages = useActivityPages(),
    summary = useActivitySummary(),
    write = useActivityWrite(),
    cache = useQueryClient()
  const [message, setMessage] = useState('')
  const retry = () => {
    void cache.resetQueries({ queryKey: ['activity-pages'] })
    void summary.refetch()
    void ctx.couple.refetch()
  }
  const items = Array.from(
    new Map(
      (pages.data?.pages.flatMap((p) => p.items) ?? []).map((i) => [i.id, i]),
    ).values(),
  )
  let group = ''
  return (
    <div className="space-y-5 activity-screen">
      <PageHeader
        eyebrow="Ваш простір для двох"
        title="Події пари"
        back="/"
        description="Помічати хороше. Повертатися до спільного."
        action={
          <OverflowMenu locale="uk" label="Налаштування подій">
            <Button variant="outline" onClick={retry}>
              Оновити список
            </Button>
            <p>Підтримка завжди добровільна.</p>
            <Button
              variant="outline"
              disabled={
                !ctx.enabled ||
                summary.isError ||
                !summary.data ||
                write.isPending
              }
              onClick={() => {
                setMessage('')
                write.mutate(
                  {
                    kind: 'preferences',
                    enabled: !summary.data!.reactions_enabled,
                  },
                  { onError: (e) => setMessage(activityError(e)) },
                )
              }}
            >
              {summary.data?.reactions_enabled
                ? 'Вимкнути сповіщення про реакції'
                : 'Увімкнути сповіщення про реакції'}
            </Button>
            <p>Запрошення та важливі події залишаться доступними.</p>
          </OverflowMenu>
        }
      />
      {!ctx.online ? (
        <Card>
          <WifiOff className="mb-3" />
          <p role="status">
            Зараз немає зв’язку. Події перевіримо, коли мережа повернеться.
          </p>
        </Card>
      ) : ctx.couple.isError || pages.isError ? (
        <ActivityProblem error={pages.error} retry={retry} />
      ) : ctx.couple.isPending || pages.isPending ? (
        <Card>
          <p role="status">Збираємо ваші моменти…</p>
        </Card>
      ) : (
        <>
          {(!ctx.enabled ||
            (pages.isFetching && !pages.isFetchingNextPage)) && (
            <p role="status">Оновлюємо події…</p>
          )}
          <div
            className="space-y-5"
            hidden={
              !ctx.enabled || (pages.isFetching && !pages.isFetchingNextPage)
            }
          >
            {items.some((i) => !i.read_at) && (
              <Button
                variant="outline"
                disabled={write.isPending}
                onClick={() => {
                  setMessage('')
                  write.mutate(
                    { kind: 'read', id: null },
                    { onError: (e) => setMessage(activityError(e)) },
                  )
                }}
              >
                <Check size={17} />
                Прочитати всі
              </Button>
            )}
            {!items.length && (
              <Card className="activity-empty">
                <div className="activity-empty-icon">
                  <Heart size={32} />
                </div>
                <h2>Поки тихо й затишно</h2>
                <p>
                  Нові запрошення та спільні моменти з’являться тут. Поспішати
                  нікуди.
                </p>
              </Card>
            )}
            <div className="activity-list">
              {items.map((item) => {
                const day = activityDay(item.created_at),
                  heading = day !== group
                group = day
                return (
                  <section key={item.id}>
                    {heading && <h2 className="activity-day">{day}</h2>}
                    <ActivityCard item={item} />
                  </section>
                )
              })}
            </div>
            {pages.hasNextPage && (
              <Button
                variant="outline"
                disabled={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              >
                {pages.isFetchingNextPage ? 'Завантажуємо…' : 'Раніші події'}
              </Button>
            )}
          </div>
        </>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  )
}
export function ActivityCard({ item }: { item: ActivityItem }) {
  const write = useActivityWrite(),
    navigate = useNavigate(),
    [message, setMessage] = useState(''),
    text = activityText[item.kind],
    reaction = reactions.find((r) => r.kind === item.reaction)
  async function read(open: boolean) {
    setMessage('')
    try {
      const result = await write.mutateAsync({ kind: 'read', id: item.id })
      if (open && result.path) navigate(result.path)
    } catch (e) {
      setMessage(activityError(e))
    }
  }
  return (
    <article
      className={'activity-card ' + (!item.read_at ? 'unread' : '')}
      aria-label={text.title}
    >
      <div className="activity-card-top">
        <span className="activity-symbol" aria-hidden="true">
          {item.kind === 'reaction'
            ? (reaction?.emoji ?? '❤️')
            : item.kind.includes('consent') || item.kind === 'connection_invite'
              ? '✉'
              : '♡'}
        </span>
        <div>
          <h3>{text.title}</h3>
          <time dateTime={item.created_at}>
            {new Intl.DateTimeFormat('uk-UA', {
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(item.created_at))}
          </time>
        </div>
        {!item.read_at && (
          <span
            className="activity-unread-dot"
            role="img"
            aria-label="Непрочитано"
          />
        )}
      </div>
      {item.subject && <p className="activity-subject">{item.subject}</p>}
      <p className="activity-description">
        {item.kind === 'reaction' && reaction
          ? reaction.label
          : text.description}
      </p>
      <div className="activity-card-actions">
        {
          <Button disabled={write.isPending} onClick={() => void read(true)}>
            {text.action}
            <ArrowRight size={16} />
          </Button>
        }
        {!item.read_at && (
          <Button
            variant="ghost"
            disabled={write.isPending}
            onClick={() => void read(false)}
          >
            Прочитано
          </Button>
        )}
      </div>
      {item.can_react && <ReactionPicker item={item} />}
      {message && <p role="alert">{message}</p>}
    </article>
  )
}
function ReactionPicker({ item }: { item: ActivityItem }) {
  const { session } = useAuth(),
    write = useActivityWrite(),
    cache = useQueryClient(),
    { context } = useActivityContext(),
    intentKey = ['activity-intent', session?.user.id, context, item.id],
    key = `kolo:activity:${session?.user.id}:${context}:${item.id}`
  const [pending, setPending] = useState<ReactionIntent | null>(() => {
      const saved = cache.getQueryData<ReactionIntent>(intentKey)
      if (saved) return saved
      try {
        const v = JSON.parse(sessionStorage.getItem(key) ?? 'null')
        return v?.event === item.id && typeof v?.request === 'string' ? v : null
      } catch {
        return null
      }
    }),
    [message, setMessage] = useState('')
  function retain(v: ReactionIntent | null) {
    setPending(v)
    if (v) {
      cache.setQueryDefaults(['activity-intent'], { gcTime: Infinity })
      cache.setQueryData(intentKey, v)
    } else cache.removeQueries({ queryKey: intentKey, exact: true })
    try {
      if (v) sessionStorage.setItem(key, JSON.stringify(v))
      else sessionStorage.removeItem(key)
    } catch {
      /* memory retains intent when storage is unavailable */
    }
  }
  async function send(intent: ReactionIntent) {
    retain(intent)
    setMessage('')
    try {
      await write.mutateAsync({ kind: 'reaction', intent })
      retain(null)
    } catch (e) {
      setMessage(activityError(e))
    }
  }
  function choose(kind: ReactionKind) {
    if (pending) return
    void send({
      event: item.id,
      kind: item.own_reaction === kind ? null : kind,
      expected: item.own_reaction ?? null,
      request: crypto.randomUUID(),
    })
  }
  return (
    <div className="activity-reactions">
      <div role="group" aria-label="Підтримати партнера">
        {reactions.map((r) => (
          <button
            type="button"
            key={r.kind}
            aria-label={r.label}
            aria-pressed={item.own_reaction === r.kind}
            disabled={!!pending || write.isPending}
            onClick={() => choose(r.kind)}
          >
            <span aria-hidden="true">{r.emoji}</span>
            <span>{r.label}</span>
          </button>
        ))}
      </div>
      {pending && !write.isPending && (
        <div className="activity-recovery">
          <p role="status">
            Результат поки невідомий. Нову реакцію не надсилаємо.
          </p>
          <Button
            variant="outline"
            onClick={() =>
              void cache.invalidateQueries({ queryKey: ['activity-pages'] })
            }
          >
            Перевірити події
          </Button>
          <Button variant="ghost" onClick={() => void send(pending)}>
            Повторити той самий вибір
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              retain(null)
              setMessage('')
              void cache.invalidateQueries({ queryKey: ['activity-pages'] })
            }}
          >
            Завершити цю спробу
          </Button>
        </div>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  )
}
export function TodayActivity() {
  const { client } = useAuth()
  return client ? <LiveTodayActivity /> : null
}
function LiveTodayActivity() {
  const { enabled } = useActivityContext(),
    q = useActivitySummary(),
    item = q.data?.spotlight
  if (!enabled || q.isError || q.isFetching || !item) return null
  return (
    <aside className="today-activity" aria-label="Важливе для вас">
      <Bell size={19} aria-hidden="true" />
      <div>
        <p>{activityText[item.kind].title}</p>
        <Link to="/activity">
          Переглянути подію <span aria-hidden="true">→</span>
        </Link>
      </div>
    </aside>
  )
}
