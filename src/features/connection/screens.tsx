import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { useAuth } from '../auth/auth-context'
import { useConnection, useConnectionPages, useConnectionWrite } from './api'
import {
  catalog,
  moods,
  reactions,
  compareAnswers,
  connectionError,
  type Home,
  type Detail,
  type Write,
  type ConnectionSession,
  type HistoryItem,
} from './model'

/** Retain original request including version. No mutation runs on mount/reconnect. */
export function Action({
  action,
  id = null,
  expected = 0,
  payload = {},
  children,
  disabled = false,
  onDone,
}: {
  action: string
  id?: string | null
  expected?: number
  payload?: Record<string, unknown>
  children: React.ReactNode
  disabled?: boolean
  onDone?: () => void
}) {
  const { client, session, online } = useAuth(),
    write = useConnectionWrite()
  const key = `kolo:connection:${session?.user.id}:${action}:${id ?? 'new'}`
  const [intent, setIntent] = useState<Write | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? 'null')
    } catch {
      return null
    }
  })
  const [message, setMessage] = useState(''),
    [checking, setChecking] = useState(false)
  function retain(w: Write | null) {
    setIntent(w)
    try {
      if (w) sessionStorage.setItem(key, JSON.stringify(w))
      else sessionStorage.removeItem(key)
    } catch {
      /* memory fallback + server fences */
    }
  }
  async function send() {
    const w = intent ?? {
      action,
      id,
      expected,
      payload: structuredClone(payload),
      request: crypto.randomUUID(),
    }
    retain(w)
    setMessage('')
    try {
      await write.mutateAsync(w)
      retain(null)
      if (
        ['delete_own_history', 'erase_answers', 'unpublish'].includes(action)
      ) {
        try {
          for (const k of Object.keys(sessionStorage))
            if (
              k.startsWith(`kolo:connection:${session?.user.id}:`) &&
              id &&
              k.endsWith(':' + id)
            )
              sessionStorage.removeItem(k)
        } catch {
          /* storage may be unavailable */
        }
      }
      setMessage('Збережено.')
      onDone?.()
    } catch (e) {
      setMessage(connectionError(e))
    }
  }
  async function inspect() {
    setChecking(true)
    try {
      const r = await client!.rpc('connection_read', {
        p_view: 'request',
        p_id: intent!.request,
        p_cursor: null,
      })
      if (r.error) throw r.error
      const e = r.data as unknown as { data: unknown }
      if (e.data !== null) {
        retain(null)
        setMessage('Запит уже виконано. Оновіть дані.')
        onDone?.()
      } else
        setMessage(
          'Запит не знайдено. Можна явно повторити те саме початкове надсилання.',
        )
    } catch (e) {
      setMessage(connectionError(e))
    } finally {
      setChecking(false)
    }
  }
  return (
    <div className="space-y-2">
      <Button
        type="button"
        disabled={disabled || write.isPending || checking || !online}
        onClick={() => void send()}
      >
        {write.isPending
          ? 'Зберігаємо…'
          : intent
            ? 'Повторити початковий запит'
            : children}
      </Button>
      {intent && !write.isPending && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void inspect()}
            disabled={!online || checking}
          >
            Перевірити результат
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              retain(null)
              setMessage(
                'Намір очищено. Перевірте історію перед окремою новою дією.',
              )
            }}
          >
            Скасувати намір
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {!online && (
        <p role="status">
          Немає зв’язку. Нічого не буде надіслано автоматично.
        </p>
      )}
    </div>
  )
}
export function ConnectionLinks() {
  return (
    <Card lang="uk" className="space-y-3">
      <h2 className="text-xl font-semibold">Пізнаємо одне одного</h2>
      <p className="text-sm text-muted-foreground">
        Добровільно, у своєму темпі. Без оцінок і винагород.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link to="/us/connection/mood" className="underline">
          Наш настрій
        </Link>
        <Link to="/us/connection/questionnaires" className="underline">
          Опитування для двох
        </Link>
        <Link to="/us/connection/game" className="underline">
          Гра «Між нами»
        </Link>
      </div>
    </Card>
  )
}
function Feedback({
  pending,
  error,
  retry,
}: {
  pending: boolean
  error: unknown
  retry: () => void
}) {
  return pending ? (
    <p role="status">Завантажуємо…</p>
  ) : error ? (
    <div role="alert">
      <p>{connectionError(error)}</p>
      <Button onClick={retry}>Оновити дані</Button>
    </div>
  ) : null
}
export function TodayConnection() {
  const { client } = useAuth()
  return (
    <>
      <ConnectionLinks />
      {client ? (
        <MoodPanel compact />
      ) : (
        <p lang="uk">Демонстрація: настрій та відповіді не зберігаються.</p>
      )}
    </>
  )
}
const moodSchema = z.object({
  mood: z.enum([
    'wonderful',
    'good',
    'calm',
    'tired',
    'anxious',
    'sad',
    'irritated',
    'uncertain',
  ]),
  intensity: z.coerce.number().min(1).max(5),
  note: z.string().max(500),
  support: z.boolean(),
  shared: z.boolean(),
})
type MoodValues = z.infer<typeof moodSchema>
function MoodEditor({ home }: { home: Home }) {
  const { session } = useAuth(),
    own = home.moods.find((m) => m.day === home.today)
  const {
    register,
    control,
    formState: { errors },
  } = useForm<MoodValues>({
    resolver: zodResolver(moodSchema),
    mode: 'onChange',
    defaultValues: own ?? {
      mood: 'uncertain',
      intensity: 3,
      note: '',
      support: false,
      shared: false,
    },
  })
  const values = useWatch({ control }),
    valid = moodSchema.safeParse(values)
  return (
    <div className="space-y-3">
      <label className="block">
        Емоційний стан
        <select {...register('mood')} className="connection-input">
          {moods.map(([id, title, emoji]) => (
            <option value={id} key={id}>
              {emoji} {title}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Інтенсивність (1–5)
        <input
          type="range"
          min="1"
          max="5"
          {...register('intensity')}
          className="block w-full"
        />
        <output>{values.intensity}</output>
      </label>
      <label className="block">
        Короткий коментар
        <textarea
          maxLength={500}
          {...register('note')}
          className="connection-input"
        />
      </label>
      {errors.note && <p role="alert">Не більше 500 символів.</p>}
      <label className="flex gap-2">
        <input type="checkbox" {...register('support')} />
        Мені потрібна підтримка
      </label>
      <label className="flex gap-2">
        <input type="checkbox" {...register('shared')} />
        Поділитися з нинішнім партнером (необов’язково)
      </label>
      <Action
        action="mood"
        expected={own?.version ?? 0}
        payload={{
          ...values,
          intensity: Number(values.intensity),
          day: home.today,
        }}
        disabled={!valid.success}
      >
        Зберегти мій настрій
      </Action>
      <p className="text-xs text-muted-foreground">
        Приватно за замовчуванням. Після зміни запису попередні реакції
        очищуються. День визначається за UTC.
      </p>
      {home.reactions
        .filter((r) => r.owner_id === session?.user.id)
        .map((r) => (
          <p key={r.user_id}>
            Підтримка: {reactions.find(([id]) => id === r.reaction)?.[1]}
          </p>
        ))}
    </div>
  )
}
function MoodPanel({ compact = false }: { compact?: boolean }) {
  const home = useConnection<Home>('home')
  const { session } = useAuth()
  return (
    <Card lang="uk" className="space-y-4">
      <h2 className="text-xl font-semibold">Як ти сьогодні?</h2>
      <p>Можна нічого не обирати. Тобі не потрібно пояснювати свій стан.</p>
      <Feedback
        pending={home.isPending}
        error={home.error}
        retry={() => void home.refetch()}
      />
      {!home.isError && home.data && (
        <>
          <MoodEditor
            key={
              home.data.today +
              ':' +
              (home.data.moods.find((m) => m.day === home.data.today)
                ?.version ?? 0)
            }
            home={home.data}
          />
          {home.data.partner_mood && (
            <section className="rounded-2xl border border-border p-4 space-y-3">
              <h3>Партнер поділився настроєм</h3>
              <p>
                {
                  moods.find(
                    ([id]) => id === home.data!.partner_mood!.mood,
                  )?.[1]
                }{' '}
                · {home.data.partner_mood.intensity}/5
              </p>
              <p className="whitespace-pre-wrap break-words">
                {home.data.partner_mood.note}
              </p>
              {home.data.partner_mood.support && (
                <p>Підтримка буде доречною; пояснення не обов’язкові.</p>
              )}
              {reactions.map(([id, label]) => (
                <Action
                  key={id}
                  action="react"
                  id={idToUuid(id)}
                  payload={{ day: home.data!.today, reaction: id }}
                >
                  {label}
                </Action>
              ))}
            </section>
          )}
          {!compact && (
            <section>
              <h3>Мій календар · 30 днів UTC</h3>
              <p className="text-sm">
                Категорії стану, без оцінки «краще/гірше» та діагнозів.
                Інтенсивність — твій власний опис.
              </p>
              <div
                className="grid grid-cols-5 gap-2 mt-3"
                aria-label="Календар настрою"
              >
                {Array.from({ length: 30 }, (_, i) => {
                  const day = new Date(
                      Date.parse(home.data!.today + 'T00:00:00Z') -
                        (29 - i) * 86400000,
                    )
                      .toISOString()
                      .slice(0, 10),
                    m = home.data!.moods.find((x) => x.day === day)
                  return (
                    <div
                      className="rounded-xl border border-border p-2 text-center"
                      key={day}
                      title={
                        day +
                        ': ' +
                        (m
                          ? moods.find(([id]) => id === m.mood)?.[1]
                          : 'Без запису')
                      }
                    >
                      <small>{day.slice(5)}</small>
                      <p>
                        {m ? moods.find(([id]) => id === m.mood)?.[2] : '·'}
                      </p>
                      {m && (
                        <span aria-label={'Інтенсивність ' + m.intensity}>
                          <span
                            className="block h-1 rounded bg-primary"
                            style={{ width: m.intensity * 20 + '%' }}
                          />
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <ul className="mt-3 space-y-2">
                {home.data.moods
                  .filter((m) => m.user_id === session?.user.id)
                  .map((m) => (
                    <li key={m.day} className="break-words">
                      {m.day}: {moods.find(([id]) => id === m.mood)?.[1]} ·{' '}
                      {m.intensity}/5 · {m.shared ? 'Поширено' : 'Приватно'}
                      <p>{m.note}</p>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}
      {!home.isError && home.data?.active_game_id && (
        <Link
          className="block underline"
          to={'/us/connection/session/' + home.data.active_game_id}
        >
          Повернутися до нашої гри «Між нами»
        </Link>
      )}
      {!home.isError &&
        home.data?.events.map((e) => (
          <Link
            className="block underline"
            key={e.session_id + e.position}
            to={
              '/us/connection/session/' + e.session_id + '?card=' + e.position
            }
          >
            Партнер запрошує подивитися картку №{e.position}
          </Link>
        ))}
    </Card>
  )
}
function idToUuid(id: string) {
  return `00000000-0000-4000-8000-${String(reactions.findIndex(([k]) => k === id) + 1).padStart(12, '0')}`
}
export function PlayingCard({
  card,
  number,
  remaining,
}: {
  card: (typeof catalog.cards)[number] | null
  number: number
  remaining: number
}) {
  const [flipped, setFlipped] = useState(false),
    category = catalog.categories.find((c) => c.id === card?.category)
  return (
    <div
      className="romantic-deck"
      style={
        {
          '--card-color': category?.color ?? '#76618E',
          '--stack-size': Math.min(3, Math.ceil(remaining / 50)),
        } as React.CSSProperties
      }
    >
      <button
        type="button"
        className={'romantic-card ' + (flipped ? 'is-flipped' : '')}
        onClick={() => setFlipped((v) => !v)}
        aria-label={flipped ? 'Показати запитання' : 'Перевернути картку'}
        aria-pressed={flipped}
      >
        <span className="romantic-face" aria-hidden={flipped}>
          <span className="romantic-category">
            {category?.title ?? 'Між нами'}
          </span>
          <span className="romantic-symbol" aria-hidden="true">
            {category?.symbol ?? '✧'}
          </span>
          <span className="romantic-question">
            {card?.text ??
              'Простір для вашої розмови. Почніть, коли обоє готові.'}
          </span>
          <span className="romantic-number">
            {number ? String(number).padStart(3, '0') : 'KOLO'} · Між нами
          </span>
        </span>
        <span className="romantic-face romantic-back" aria-hidden={!flipped}>
          <span aria-hidden="true">❧ · ☾ · ❧</span>
          <strong>
            Між
            <br />
            нами
          </strong>
          <span>Ближче. У власному темпі.</span>
        </span>
      </button>
    </div>
  )
}
export function ConnectionHub({
  mode,
}: {
  mode: 'mood' | 'questionnaires' | 'game'
}) {
  const { client } = useAuth()
  return (
    <div lang="uk" className="space-y-5">
      <Link className="underline" to="/us">
        ← Ми
      </Link>
      <ConnectionLinks />
      {!client ? (
        <DemoConnection />
      ) : mode === 'mood' ? (
        <MoodPanel />
      ) : (
        <SessionList mode={mode} />
      )}
    </div>
  )
}
function SessionList({ mode }: { mode: 'questionnaires' | 'game' }) {
  const home = useConnection<Home>('home'),
    list = useConnectionPages<ConnectionSession>('sessions')
  return (
    <>
      <Card className="space-y-4">
        <h1 className="text-2xl font-semibold">
          {mode === 'game'
            ? 'Гра «Між нами»'
            : 'Опитування для самопізнання та діалогу'}
        </h1>
        <p>
          Без діагностики та оцінки сумісності. Кожен може відмовитися. Жодних
          XP чи Coins.
        </p>
        {mode === 'game' ? (
          <>
            <PlayingCard card={null} number={0} remaining={150} />
            <p>
              150 оригінальних запитань, п’ять категорій. Відверті категорії
              відкриваються лише за згодою обох. Відповідь ніколи не означає
              згоди на фізичну дію.
            </p>
            {!home.isError && home.data && (
              <Action
                action="start_game"
                expected={home.data.game_version}
                onDone={() => void list.refetch()}
              >
                Запросити до нової гри
              </Action>
            )}
          </>
        ) : (
          catalog.questionnaires.map((q) => (
            <section
              key={q.id}
              className="rounded-2xl border border-border p-4 space-y-3"
            >
              <h2 className="font-semibold">{q.title}</h2>
              <p>10 авторських запитань · можна зберігати прогрес</p>
              {!home.isError && home.data && (
                <Action
                  action="start_questionnaire"
                  id={quizUuid(q.id)}
                  expected={home.data.questionnaire_version}
                  payload={{ catalog: q.id }}
                  onDone={() => void list.refetch()}
                >
                  Запросити: {q.title}
                </Action>
              )}
            </section>
          ))
        )}
      </Card>
      <Feedback
        pending={list.isPending || home.isPending}
        error={list.error ?? home.error}
        retry={() => {
          void list.refetch()
          void home.refetch()
        }}
      />
      <Card className="space-y-3">
        <h2>Ваші сесії та історія</h2>
        {!list.isError &&
          list.data?.pages
            .flatMap((p) => p.items)
            .filter(
              (s) => s.kind === (mode === 'game' ? 'game' : 'questionnaire'),
            )
            .map((s) => (
              <Link
                className="block rounded-xl border border-border p-4"
                to={'/us/connection/session/' + s.id}
                key={s.id}
              >
                {s.kind === 'game'
                  ? 'Між нами'
                  : catalog.questionnaires.find((q) => q.id === s.catalog_id)
                      ?.title}{' '}
                · {statusText(s.status)} · {s.created_at.slice(0, 10)}
              </Link>
            ))}
        {!list.isPending && !list.data?.pages.some((p) => p.items.length) && (
          <p>Тут з’явиться ваша спільна історія. Почати необов’язково.</p>
        )}
        {list.hasNextPage && (
          <Button
            onClick={() => void list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
          >
            Попередні сесії
          </Button>
        )}
      </Card>
    </>
  )
}
function quizUuid(id: string) {
  return `00000000-0000-4000-8000-${String(catalog.questionnaires.findIndex((q) => q.id === id) + 1).padStart(12, '0')}`
}
function statusText(status: string) {
  return (
    (
      {
        pending: 'Очікує згоди',
        active: 'Активна',
        paused: 'На паузі',
        closed: 'Завершено участь',
        completed: 'Пройдено разом',
        declined: 'Запрошення відхилено',
      } as Record<string, string>
    )[status] ?? status
  )
}
export function ConnectionDetail() {
  const { connectionId } = useParams(),
    [search] = useSearchParams(),
    { client, session } = useAuth(),
    detail = useConnection<Detail>('session', connectionId ?? null)
  if (!client) return <DemoConnection />
  return (
    <div lang="uk" className="space-y-5">
      <Link to="/us/connection/game" className="underline">
        ← Пізнаємо одне одного
      </Link>
      <Feedback
        pending={detail.isPending}
        error={detail.error}
        retry={() => void detail.refetch()}
      />
      {!detail.isError && detail.data && (
        <>
          {search.get('card') && (
            <InvitedCard id={connectionId!} slot={search.get('card')!} />
          )}
          <Card className="space-y-4">
            <h1 className="text-2xl font-semibold">
              {detail.data.session.kind === 'game'
                ? 'Між нами'
                : detail.data.questionnaire?.title}
            </h1>
            <p>{statusText(detail.data.session.status)}</p>
            {detail.data.session.status === 'pending' && (
              <>
                <p>Відповіді не розкриваються без окремої згоди обох.</p>
                {detail.data.session.b === session?.user.id && (
                  <>
                    <Action
                      action="accept"
                      id={connectionId}
                      onDone={() => void detail.refetch()}
                    >
                      Прийняти запрошення
                    </Action>
                    <Action action="decline" id={connectionId}>
                      Відхилити без пояснення
                    </Action>
                  </>
                )}
              </>
            )}
            {['active', 'paused'].includes(detail.data.session.status) && (
              <>
                <Action
                  action={
                    detail.data.session.status === 'paused' ? 'resume' : 'pause'
                  }
                  id={connectionId}
                >
                  {detail.data.session.status === 'paused'
                    ? 'Відновити гру / проходження'
                    : 'Зробити паузу'}
                </Action>
                <Action action="close" id={connectionId}>
                  Відмовитися від подальшої участі
                </Action>
              </>
            )}
          </Card>
          {detail.data.session.kind === 'game' ? (
            <Game detail={detail.data} />
          ) : (
            detail.data.session.status !== 'pending' && (
              <QuestionnaireForm
                key={
                  connectionId +
                  ':' +
                  (detail.data.answers.find(
                    (a) => a.user_id === session?.user.id,
                  )?.version ?? 0)
                }
                detail={detail.data}
              />
            )
          )}
        </>
      )}
    </div>
  )
}
function Game({ detail }: { detail: Detail }) {
  const s = detail.session,
    { session } = useAuth(),
    own = detail.answers.find((a) => a.user_id === session?.user.id),
    both =
      detail.answers.length === 2 && detail.answers.every((a) => a.submitted)
  return (
    <>
      <Card className="space-y-5">
        <p>
          Картка {s.position} із 150 · Залишилося {detail.remaining}
        </p>
        <PlayingCard
          key={s.position}
          card={detail.card}
          number={s.position}
          remaining={detail.remaining}
        />
        <p>
          Можна пропустити без пояснення. Згода на відповідь не є згодою на
          фізичні дії.
        </p>
        {['active', 'paused'].includes(s.status) && (
          <>
            <p>
              Відверті категорії «Високі температури» та «Таємне та бажане»:{' '}
              {s.opt_a && s.opt_b ? 'дозволені обома' : 'закриті до згоди обох'}
              .
            </p>
            <Action
              action="opt"
              id={s.id}
              payload={{
                enabled: !(s.a === session?.user.id ? s.opt_a : s.opt_b),
              }}
            >
              {(s.a === session?.user.id ? s.opt_a : s.opt_b)
                ? 'Відкликати мою згоду на відверті категорії'
                : 'Добровільно дозволити відверті категорії'}
            </Action>
          </>
        )}
        {s.position > 0 && (
          <>
            <p>
              Твоя участь:{' '}
              {own?.submitted
                ? own.skipped
                  ? 'Пропущено'
                  : 'Відповідь надіслано'
                : 'У власному темпі'}
            </p>
            <p>
              Партнер:{' '}
              {detail.answers.some(
                (a) => a.user_id !== session?.user.id && a.submitted,
              )
                ? 'Завершив(-ла) участь'
                : 'Ще не завершено'}
            </p>
            {s.status === 'active' && detail.card && !own?.submitted && (
              <CardAnswer
                key={s.id + ':' + s.position + ':' + (own?.version ?? 0)}
                detail={detail}
              />
            )}
            {s.status === 'active' && !detail.card && !own?.submitted && (
              <Action
                action="skip"
                id={s.id}
                expected={own?.version ?? 0}
                payload={{ slot: String(s.position) }}
              >
                Пропустити закрите запитання
              </Action>
            )}
            <Published detail={detail} />
            {s.status === 'active' && (
              <Action action="notify" id={s.id} expected={s.position}>
                Надіслати партнеру
              </Action>
            )}
            <Action action="ack" id={s.id} expected={s.position}>
              Позначити запрошення переглянутим
            </Action>
          </>
        )}
        {s.status === 'active' && (
          <Action
            action="draw"
            id={s.id}
            expected={s.position}
            disabled={s.position > 0 && !both}
          >
            {s.position === 0
              ? 'Витягнути першу картку'
              : s.position === 150
                ? 'Завершити колоду'
                : 'Наступна картка'}
          </Action>
        )}
        {s.status === 'completed' && (
          <div className="deck-complete" role="status">
            <h2>150 запитань. Безліч нових відкриттів одне про одного</h2>
            <p>
              Пройдено 150 карток у п’яти категоріях. Надіслано відповідей:{' '}
              {detail.answer_count}. Відповіді й пропуски залишаються в історії.
            </p>
            <p>{catalog.categories.map((c) => c.title).join(' · ')}</p>
            <Link className="underline" to="/us/connection/game">
              Почати нову гру окремим запрошенням
            </Link>
          </div>
        )}
      </Card>
      <Card>
        <Action action="delete_own_history" id={s.id}>
          Видалити всі мої відповіді цієї гри та завершити участь
        </Action>
        <p>
          Спільний перегляд відповідей буде відкликано. Уже прочитане неможливо
          стерти дистанційно.
        </p>
      </Card>
      <GameHistory id={s.id} />
    </>
  )
}
function CardAnswer({ detail }: { detail: Detail }) {
  const { session } = useAuth(),
    own = detail.answers.find((a) => a.user_id === session?.user.id),
    { register, control } = useForm({
      defaultValues: {
        answer: typeof own?.draft === 'string' ? own.draft : '',
        publish: false,
      },
    }),
    values = useWatch({ control }),
    s = detail.session
  return (
    <section className="space-y-3">
      <label className="block">
        Моя відповідь (до 2000 символів)
        <textarea
          maxLength={2000}
          {...register('answer')}
          className="connection-input"
        />
      </label>
      <Action
        action="save"
        id={s.id}
        expected={own?.version ?? 0}
        payload={{ slot: String(s.position), answers: values.answer }}
      >
        Зберегти приватний чернетковий текст
      </Action>
      <label className="flex gap-2">
        <input type="checkbox" {...register('publish')} />
        Погоджуюся показати цю відповідь партнеру після завершення участі обома
      </label>
      <Action
        action="submit"
        id={s.id}
        expected={own?.version ?? 0}
        payload={{
          slot: String(s.position),
          answers: values.answer,
          publish: values.publish,
        }}
        disabled={!values.publish || !values.answer?.trim()}
      >
        Надіслати відповідь
      </Action>
      <Action
        action="skip"
        id={s.id}
        expected={own?.version ?? 0}
        payload={{ slot: String(s.position) }}
      >
        Пропустити запитання
      </Action>
    </section>
  )
}
function Published({ detail }: { detail: Detail }) {
  const { session } = useAuth()
  return (
    <section className="published-answers space-y-3" aria-live="polite">
      {detail.answers
        .filter((a) => a.submitted && a.draft !== null)
        .map((a) => (
          <div key={a.user_id} className="rounded-2xl border border-border p-4">
            <h3>
              {a.user_id === session?.user.id
                ? 'Твоя відповідь'
                : 'Відповідь партнера'}
            </h3>
            {a.skipped ? (
              <p>Пропущено. Це нормально.</p>
            ) : typeof a.draft === 'string' ? (
              <p className="whitespace-pre-wrap break-words">{a.draft}</p>
            ) : null}
          </div>
        ))}
    </section>
  )
}
function QuestionnaireForm({ detail }: { detail: Detail }) {
  const { session } = useAuth(),
    own = detail.answers.find((a) => a.user_id === session?.user.id),
    q = detail.questionnaire!,
    s = detail.session
  const { register, control } = useForm<{
      answers: Record<string, string>
      publish: boolean
    }>({
      defaultValues: {
        answers:
          typeof own?.draft === 'object' && own.draft !== null ? own.draft : {},
        publish: false,
      },
    }),
    values = useWatch({ control })
  const answers = Object.fromEntries(
      Object.entries(values.answers ?? {}).filter(
        ([, v]) => v !== '' && v !== undefined,
      ),
    ),
    complete = q.questions.every((x) => answers[x.id])
  const shared =
    detail.answers.length === 2 &&
    detail.answers.every((a) => a.submitted && a.draft !== null)
  const report = shared
    ? compareAnswers(
        q,
        own!.draft as Record<string, string>,
        detail.answers.find((a) => a.user_id !== session?.user.id)!
          .draft as Record<string, string>,
      )
    : null
  return (
    <Card className="space-y-5">
      <p>
        Авторське опитування для самопізнання та діалогу. Не клінічний тест;
        наукову валідність не заявлено.
      </p>
      {!own?.submitted && s.status === 'active' && (
        <>
          <div className="space-y-5">
            {q.questions.map((x, i) => (
              <label className="block" key={x.id}>
                {i + 1}. {x.text}
                <select
                  {...register(`answers.${x.id}`)}
                  className="connection-input"
                >
                  <option value="">Обрати у власному темпі</option>
                  {x.type === 'scale'
                    ? [
                        'Зовсім не погоджуюся',
                        'Скоріше не погоджуюся',
                        'Залежить від ситуації',
                        'Скоріше погоджуюся',
                        'Цілком погоджуюся',
                      ].map((v, i) => (
                        <option value={i + 1} key={v}>
                          {v}
                        </option>
                      ))
                    : x.options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                </select>
              </label>
            ))}
          </div>
          <Action
            action="save"
            id={s.id}
            expected={own?.version ?? 0}
            payload={{ slot: '0', answers }}
          >
            Зберегти лише мою чернетку
          </Action>
          <label className="flex gap-2">
            <input type="checkbox" {...register('publish')} />
            Явно погоджуюся розкрити мої відповіді у спільному звіті після
            завершення обома
          </label>
          <Action
            action="submit"
            id={s.id}
            expected={own?.version ?? 0}
            payload={{ slot: '0', answers, publish: values.publish }}
            disabled={!complete || !values.publish}
          >
            Завершити мою частину і погодитися на розкриття
          </Action>
        </>
      )}
      {own?.submitted && !shared && (
        <p>Твоя частина завершена. Чужі відповіді залишаються прихованими.</p>
      )}
      {report && (
        <section className="space-y-4">
          <h2 className="text-xl">Ваш тематичний профіль: {q.title}</h2>
          <p>{report.interpretation}</p>
          <p>
            Для шкал відстань 0–4 між відповідями описує лише цей пункт. Вибір
            варіанта порівнюється за змістовим ключем, а не номером. Загального
            відсотка «сумісності» немає.
          </p>
          <h3>Близькі відповіді</h3>
          {report.similar.map((p) => (
            <p key={p.id}>{p.text}</p>
          ))}
          <h3>Відмінності, які можна обговорити</h3>
          {report.different.map((p) => (
            <p key={p.id}>{p.text}</p>
          ))}
          <h3>Ваші відповіді</h3>
          {report.points.map((p) => {
            const x = q.questions.find((x) => x.id === p.id)!
            const label = (v: string) =>
              x.type === 'scale'
                ? v + '/5'
                : x.options.find((o) => o.id === v)?.label
            return (
              <p key={p.id}>
                {p.text}
                <br />
                Твоя: {label(p.a)} · Партнера: {label(p.b)}
              </p>
            )
          })}
          <h3>Три запитання для розмови</h3>
          <ul>
            {report.prompts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <h3>Що можна спробувати</h3>
          <ul>
            {report.actions.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}
      <Action action="erase_answers" id={s.id}>
        Відкликати розкриття та видалити мої відповіді
      </Action>
      <p className="text-xs">
        Сесію буде закрито, спільний звіт стане недоступним. Уже прочитане іншим
        користувачем неможливо дистанційно стерти.
      </p>
    </Card>
  )
}
function GameHistory({ id }: { id: string }) {
  const history = useConnectionPages<HistoryItem>('history', id)
  return (
    <Card className="space-y-3">
      <h2>Історія цієї колоди</h2>
      <Feedback
        pending={history.isPending}
        error={history.error}
        retry={() => void history.refetch()}
      />
      {!history.isError &&
        history.data?.pages
          .flatMap((p) => p.items)
          .map((h) => (
            <details key={h.slot} className="border-b border-border py-3">
              <summary>
                №{h.slot} ·{' '}
                {
                  catalog.categories.find((c) => c.id === h.card.category)
                    ?.title
                }
              </summary>
              <p>{h.card.text}</p>
              {h.answers?.map((a) => (
                <p className="break-words whitespace-pre-wrap" key={a.user_id}>
                  {a.skipped
                    ? 'Пропущено'
                    : typeof a.draft === 'string'
                      ? a.draft
                      : ''}
                </p>
              ))}
            </details>
          ))}
      {history.hasNextPage && (
        <Button
          onClick={() => void history.fetchNextPage()}
          disabled={history.isFetchingNextPage}
        >
          Попередні картки
        </Button>
      )}
    </Card>
  )
}
export function DemoConnection() {
  return (
    <div lang="uk" className="space-y-5">
      <Card>
        <h2>Демонстрація · Між нами</h2>
        <p>
          Приклад оформлення. Настрій, відповіді, згоди та серверна історія не
          зберігаються.
        </p>
        <PlayingCard card={catalog.cards[0]} number={1} remaining={149} />
        <p>
          Можна перевертати картку. Для спільної гри потрібні реальні облікові
          записи й добровільне запрошення.
        </p>
      </Card>
    </div>
  )
}

function InvitedCard({ id, slot }: { id: string; slot: string }) {
  const q = useConnection<HistoryItem | null>('card-' + slot, id)
  return (
    <Card className="space-y-4">
      <h2>Запрошення до картки №{slot}</h2>
      <Feedback
        pending={q.isPending}
        error={q.error}
        retry={() => void q.refetch()}
      />
      {!q.isError && q.data ? (
        <>
          <PlayingCard card={q.data.card} number={Number(slot)} remaining={0} />
          {q.data.answers?.map((a) => (
            <p className="break-words" key={a.user_id}>
              {a.skipped
                ? 'Пропущено'
                : typeof a.draft === 'string'
                  ? a.draft
                  : ''}
            </p>
          ))}
        </>
      ) : (
        !q.isPending && <p>Картка недоступна або категорія зараз закрита.</p>
      )}
      <Action action="ack" id={id} expected={Number(slot)}>
        Позначити запрошення переглянутим
      </Action>
    </Card>
  )
}
