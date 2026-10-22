import { useState, useEffect, useRef } from 'react'
import { Send, Heart, Sparkles, MessageCircle } from 'lucide-react'
import {
  PageHeader,
  SectionHeader,
  OverflowMenu,
  ConfirmationDialog,
  ContextualStatus,
  GentleOnboarding,
  FeatureEntry,
} from '../../components/experience'
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
  variant = 'default',
  ariaLabel,
  confirmationDetails,
}: {
  action: string
  id?: string | null
  expected?: number
  payload?: Record<string, unknown>
  children: React.ReactNode
  disabled?: boolean
  onDone?: () => void
  variant?: 'default' | 'outline' | 'ghost'
  ariaLabel?: string
  confirmationDetails?: string
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
      return true
    } catch (e) {
      setMessage(connectionError(e))
      return false
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
        setMessage('Уже збережено. Онови сторінку, щоб побачити результат.')
        onDone?.()
      } else setMessage('Збереження не знайдено. Можна повторити ті самі дані.')
    } catch (e) {
      setMessage(connectionError(e))
    } finally {
      setChecking(false)
    }
  }
  return (
    <div className="space-y-2">
      {[
        'close',
        'pause',
        'erase_answers',
        'unpublish',
        'delete_own_history',
      ].includes(action) ? (
        <ConfirmationDialog
          locale="uk"
          trigger={
            <Button
              variant={variant}
              disabled={disabled || write.isPending || !online}
            >
              {children}
            </Button>
          }
          title={
            action === 'pause'
              ? 'Поставити гру на паузу?'
              : action === 'close'
                ? 'Завершити участь?'
                : 'Видалити мої відповіді?'
          }
          description={
            confirmationDetails ??
            (action === 'pause'
              ? 'Якщо відповідь ще не збережена як чернетка, повернися й збережи її перед паузою. Пауза не публікує відповідь.'
              : action === 'close'
                ? 'Спільний перегляд буде закрито. Власні збережені відповіді залишаться приватними; закриту сесію не можна відновити.'
                : 'Твої відповіді буде видалено, спільний перегляд закрито. Відповіді партнера залишаться лише в його приватній історії. Це неможливо скасувати.')
          }
        >
          {(close) => (
            <Button
              disabled={disabled || write.isPending || !online}
              onClick={() => void send().then((done) => done && close())}
            >
              Підтвердити
            </Button>
          )}
        </ConfirmationDialog>
      ) : (
        <Button
          type="button"
          variant={variant}
          aria-label={ariaLabel}
          disabled={disabled || write.isPending || checking || !online}
          onClick={() => void send()}
        >
          {write.isPending
            ? 'Зберігаємо…'
            : intent
              ? 'Надіслати знову без змін'
              : children}
        </Button>
      )}
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
                'Перед новою дією перевір історію: попередні дані могли зберегтися.',
              )
            }}
          >
            Почати іншу дію
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
    <div lang="uk" className="space-y-3">
      <FeatureEntry
        to="/us/connection/game"
        icon={<Sparkles />}
        title="Гра «Між нами»"
        description="Одне запитання. Нова розмова."
      />
      <div className="surface-grid">
        <FeatureEntry
          to="/us/connection/questionnaires"
          icon={<MessageCircle />}
          title="Опитування для двох"
          description="Побачити знайоме по-новому"
          accent="peach"
        />
        <FeatureEntry
          to="/us/connection/mood"
          icon={<Heart />}
          title="Наш настрій"
          description="Помітити себе, підтримати одне одного"
          accent="sage"
        />
      </div>
    </div>
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
        Кілька слів, якщо хочеться
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
        Запис бачиш лише ти, доки не вирішиш поділитися.
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
      <p>Знайди хвилинку для себе.</p>
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
              <h3>Мій настрій · 30 днів</h3>
              <p className="text-sm">Твій власний погляд на останній місяць.</p>
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
  initiallyBack = false,
}: {
  card: (typeof catalog.cards)[number] | null
  number: number
  remaining: number
  initiallyBack?: boolean
}) {
  const [flipped, setFlipped] = useState(initiallyBack),
    category = catalog.categories.find((c) => c.id === card?.category)
  return (
    <div
      className="romantic-deck"
      data-empty={remaining === 0}
      data-category={card?.category ?? 'secret'}
      style={
        {
          '--card-color': category?.color ?? '#76618E',
          '--stack-size': Math.min(3, Math.ceil(remaining / 50)),
        } as React.CSSProperties
      }
    >
      <div className={'romantic-card ' + (flipped ? 'is-flipped' : '')}>
        <div className="romantic-card-inner">
          <span className="romantic-face romantic-front" aria-hidden={flipped}>
            <span className="romantic-category">
              {category?.title ?? 'Між нами'}
            </span>
            <span className="romantic-symbol" aria-hidden="true">
              {category?.symbol ?? '✧'}
            </span>
            <span className="romantic-question">
              {card?.text ??
                'Для ваших розмов, відкриттів і маленьких зізнань.'}
            </span>
            <span className="romantic-number">
              {number ? String(number).padStart(3, '0') : 'KOLO'} · Між нами
            </span>
          </span>
          <span className="romantic-face romantic-back" aria-hidden={!flipped}>
            <span className="romantic-game-name">Між нами</span>
            <svg
              className="card-ornament"
              viewBox="0 0 160 150"
              aria-hidden="true"
            >
              <path d="M80 135C64 116 14 91 23 52C29 24 62 18 80 46C98 18 131 24 137 52C146 91 96 116 80 135Z" />
              <circle cx="80" cy="75" r="60" />
              <path d="M15 75H145M80 10V140" />
              <text x="80" y="86" textAnchor="middle">
                {category?.symbol ?? '✧'}
              </text>
            </svg>
            <strong>{category?.title ?? 'Тільки ми двоє'}</strong>
            <span className="romantic-back-caption">
              Ближче з кожною розмовою
            </span>
          </span>
        </div>
        <button
          type="button"
          className="romantic-flip-trigger"
          aria-label={flipped ? 'Показати запитання' : 'Перевернути картку'}
          aria-pressed={flipped}
          onClick={() => setFlipped((v) => !v)}
        />
      </div>
    </div>
  )
}
export function ConnectionHub({
  mode,
}: {
  mode: 'mood' | 'questionnaires' | 'game'
}) {
  const { client } = useAuth()
  if (mode === 'game' && !client) return <DemoConnection />
  return (
    <div lang="uk" className="space-y-5">
      <PageHeader
        back="/us"
        title={
          mode === 'mood'
            ? 'Наш настрій'
            : mode === 'game'
              ? 'Між нами'
              : 'Опитування для двох'
        }
        description={
          mode === 'mood'
            ? 'Помітити себе. Бути поруч із близькою людиною.'
            : mode === 'game'
              ? '150 приводів поговорити про вас.'
              : 'Оберіть тему, яку цікаво відкрити разом.'
        }
      />
      {mode === 'mood' ? (
        client ? (
          <MoodPanel />
        ) : (
          <Card>
            <h2 className="text-lg font-semibold">Як ти сьогодні?</h2>
            <p className="mt-3 text-3xl">☀️ 🌿 🌧️ 🌙</p>
            <p className="text-sm text-muted-foreground mt-4">
              У вашому просторі можна зберегти стан приватно або поділитися з
              партнером. Тут — лише приклад.
            </p>
          </Card>
        )
      ) : client ? (
        <SessionList mode={mode} />
      ) : (
        <div className="surface-grid">
          {catalog.questionnaires.map((q) => (
            <details className="path-card" key={q.id}>
              <summary className="font-semibold">{q.title}</summary>
              <p className="text-sm text-muted-foreground mt-2">
                10 запитань для розмови. Наприклад:
              </p>
              <p className="mt-3">{q.questions[0].text}</p>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
function SessionList({ mode }: { mode: 'questionnaires' | 'game' }) {
  const home = useConnection<Home>('home'),
    list = useConnectionPages<ConnectionSession>('sessions'),
    items =
      list.data?.pages
        .flatMap((p) => p.items)
        .filter(
          (s) => s.kind === (mode === 'game' ? 'game' : 'questionnaire'),
        ) ?? [],
    live = items.find((s) => ['pending', 'active', 'paused'].includes(s.status))
  return (
    <>
      <Feedback
        pending={list.isPending || home.isPending}
        error={list.error ?? home.error}
        retry={() => {
          void list.refetch()
          void home.refetch()
        }}
      />
      {mode === 'game' ? (
        live ? (
          <FeatureEntry
            to={'/us/connection/session/' + live.id}
            icon={<Sparkles />}
            title={
              live.status === 'pending'
                ? 'Ваше запрошення'
                : live.status === 'paused'
                  ? 'Гра чекає на вас'
                  : 'Продовжимо з нашої картки?'
            }
            description={statusText(live.status)}
          />
        ) : (
          <div className="game-state">
            <PlayingCard card={null} number={0} remaining={150} initiallyBack />
            <h2>Ще трохи ближче</h2>
            <p>
              Запитання про спогади, мрії та те, що не завжди говоримо вголос.
            </p>
            {home.data && !home.isError && (
              <Action
                action="start_game"
                expected={home.data.game_version}
                onDone={() => void list.refetch()}
              >
                Почати гру
              </Action>
            )}
            <GentleOnboarding
              id="game-first"
              title="Власний темп — спільна колода"
            >
              Кожен може пропустити запитання. Чернетки приватні; відповіді
              відкриються тільки після участі обох і згоди на публікацію.
              Відверті категорії окремо дозволяють обоє.
            </GentleOnboarding>
          </div>
        )
      ) : (
        <>
          <GentleOnboarding
            id="questionnaires-first"
            title="Для самопізнання та діалогу"
          >
            Це авторські опитування, не клінічні тести. Спочатку відповідає
            кожен окремо; публікація потребує окремої згоди.
          </GentleOnboarding>
          <div className="surface-grid">
            {catalog.questionnaires.map((q) => (
              <section className="path-card space-y-3" key={q.id}>
                <MessageCircle size={21} className="text-primary" />
                <h2 className="font-semibold">{q.title}</h2>
                <p className="text-sm text-muted-foreground">
                  10 запитань · можна повернутися пізніше
                </p>
                {home.data && !home.isError && (
                  <Action
                    action="start_questionnaire"
                    id={quizUuid(q.id)}
                    expected={home.data.questionnaire_version}
                    payload={{ catalog: q.id }}
                    variant="outline"
                    onDone={() => void list.refetch()}
                  >
                    Запросити: {q.title}
                  </Action>
                )}
              </section>
            ))}
          </div>
        </>
      )}
      <details className="quiet-details">
        <summary>
          {mode === 'game' ? 'Наші ігри та спогади' : 'Наші опитування'}
        </summary>
        <SectionHeader
          title={mode === 'game' ? 'Ваші розмови' : 'Вибрані теми'}
        />
        {!list.isError &&
          items.map((s) => (
            <Link
              className="session-row"
              to={'/us/connection/session/' + s.id}
              key={s.id}
            >
              <span>
                {s.kind === 'game'
                  ? 'Між нами'
                  : catalog.questionnaires.find((q) => q.id === s.catalog_id)
                      ?.title}
                <small>{statusText(s.status)}</small>
              </span>
              <span>
                {new Date(s.created_at).toLocaleDateString('uk-UA', {
                  day: 'numeric',
                  month: 'short',
                })}{' '}
                →
              </span>
            </Link>
          ))}
        {!items.length && !list.isPending && (
          <p className="text-sm text-muted-foreground">
            Тут збережуться ваші розмови.
          </p>
        )}
        {list.hasNextPage && (
          <Button
            variant="outline"
            onClick={() => void list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
          >
            Показати ще
          </Button>
        )}
      </details>
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
  const d = detail.data
  return (
    <div lang="uk" className="space-y-5">
      <Feedback
        pending={detail.isPending}
        error={detail.error}
        retry={() => void detail.refetch()}
      />
      {!detail.isError &&
        d &&
        (search.get('card') &&
        Number(search.get('card')) !== d.session.position ? (
          <>
            <PageHeader
              title="Картка для тебе"
              back={'/us/connection/session/' + connectionId}
            />
            <InvitedCard id={connectionId!} slot={search.get('card')!} />
          </>
        ) : d.session.kind === 'game' ? (
          <Game detail={d} />
        ) : (
          <>
            <PageHeader
              title={d.questionnaire?.title ?? 'Опитування'}
              back="/us/connection/questionnaires"
              action={
                <OverflowMenu locale="uk" label="Дії опитування">
                  <Action
                    action="close"
                    id={connectionId}
                    variant="ghost"
                    confirmationDetails="Твої відповіді цього опитування буде видалено, а спільний звіт закрито. Відповіді партнера залишаться лише в його приватній історії. Це неможливо скасувати."
                  >
                    Завершити участь
                  </Action>
                </OverflowMenu>
              }
            />
            <ContextualStatus>{statusText(d.session.status)}</ContextualStatus>
            {d.session.status === 'pending' ? (
              <Card className="space-y-4">
                <p>
                  Запрошення від партнера. Власні відповіді залишаться
                  приватними до окремої згоди на спільний звіт.
                </p>
                {d.session.b === session?.user.id ? (
                  <div className="flex flex-wrap gap-3">
                    <Action action="accept" id={connectionId}>
                      Прийняти запрошення
                    </Action>
                    <Action action="decline" id={connectionId} variant="ghost">
                      Не зараз
                    </Action>
                  </div>
                ) : (
                  <p>Чекаємо на відповідь партнера</p>
                )}
              </Card>
            ) : (
              <QuestionnaireForm
                key={
                  connectionId +
                  ':' +
                  (d.answers.find((a) => a.user_id === session?.user.id)
                    ?.version ?? 0)
                }
                detail={d}
              />
            )}
          </>
        ))}
    </div>
  )
}
function GameMenu({ detail }: { detail: Detail }) {
  const s = detail.session,
    { session } = useAuth(),
    mine = s.a === session?.user.id ? s.opt_a : s.opt_b
  return (
    <OverflowMenu locale="uk" label="Налаштування гри">
      {s.status === 'active' && (
        <Action action="pause" id={s.id} variant="ghost">
          Поставити на паузу
        </Action>
      )}
      {s.status === 'paused' && (
        <Action action="resume" id={s.id} variant="ghost">
          Продовжити
        </Action>
      )}
      {(['active', 'paused'].includes(s.status) || mine) && (
        <details>
          <summary>
            Відверті категорії {s.opt_a && s.opt_b ? '· відкриті' : '· закриті'}
          </summary>
          <p>
            «Високі температури» та «Таємне та бажане» відкриються лише за
            окремою згодою обох. Кожне запитання можна пропустити; відповідь не
            є згодою на фізичну дію.
          </p>
          {mine ? (
            <Action
              action="opt"
              id={s.id}
              payload={{ enabled: false }}
              variant="ghost"
            >
              Відкликати мою згоду на відверті категорії
            </Action>
          ) : (
            <ConfirmationDialog
              locale="uk"
              trigger={
                <Button variant="outline">Дозволити відверті категорії</Button>
              }
              title="Відкрити відверті категорії?"
              description="Це запрошення до розмови про бажання, а не до дій. Потрібна згода обох; ти можеш відкликати свою будь-коли."
            >
              {(close) => (
                <Action
                  action="opt"
                  id={s.id}
                  payload={{ enabled: true }}
                  onDone={close}
                >
                  Я погоджуюся
                </Action>
              )}
            </ConfirmationDialog>
          )}
        </details>
      )}
      {['pending', 'active', 'paused', 'completed'].includes(s.status) && (
        <Action action="close" id={s.id} variant="ghost">
          Завершити участь
        </Action>
      )}
      <Action action="delete_own_history" id={s.id} variant="ghost">
        Видалити мої відповіді
      </Action>
      <details>
        <summary>Правила й приватність</summary>
        <p>
          Кожен відповідає лише за себе. Чернетка приватна; опубліковані
          відповіді відкриваються після участі обох. Закриття відкликає спільний
          перегляд; видалення прибирає тільки твої тексти.
        </p>
        <p>Уже прочитані копії дистанційно не видаляються.</p>
      </details>
    </OverflowMenu>
  )
}
export function Game({ detail }: { detail: Detail }) {
  const s = detail.session,
    { session } = useAuth(),
    own = detail.answers.find((a) => a.user_id === session?.user.id),
    both =
      ['active', 'paused', 'completed'].includes(s.status) &&
      detail.answers.length === 2 &&
      detail.answers.every((a) => a.submitted),
    cardAllowed =
      !!detail.card &&
      (!['heat', 'secret'].includes(detail.card.category) ||
        (s.opt_a && s.opt_b))
  const waiting = own?.submitted && !both
  return (
    <div className="game-scene" lang="uk">
      <div className="game-toolbar">
        <Link className="back-link" to="/us/connection/game">
          ← Ігри
        </Link>
        <div className="game-title">
          <p className="eyebrow">Час для двох</p>
          <h1>Між нами</h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="game-counter"
            aria-label={`Картка ${s.position} із 150`}
          >
            {s.position} / 150
          </span>
          <GameMenu detail={detail} />
        </div>
      </div>
      {s.status === 'pending' ? (
        <div className="game-state">
          <PlayingCard card={null} number={0} remaining={150} initiallyBack />
          <h2>
            {s.b === session?.user.id
              ? 'Є запрошення для тебе'
              : 'Запрошення надіслано'}
          </h2>
          <p>
            {s.b === session?.user.id
              ? '150 приводів поговорити про вас. Можна пропускати будь-яке запитання.'
              : 'Почнемо, коли партнер буде готовий.'}
          </p>
          {s.b === session?.user.id && (
            <div className="flex flex-wrap justify-center gap-3">
              <Action action="accept" id={s.id}>
                Прийняти запрошення
              </Action>
              <Action action="decline" id={s.id} variant="ghost">
                Не зараз
              </Action>
            </div>
          )}
        </div>
      ) : s.status === 'paused' ? (
        <div className="game-state">
          <PlayingCard
            card={null}
            number={s.position}
            remaining={detail.remaining}
            initiallyBack
          />
          <h2>Гра на паузі</h2>
          <p>Ваша картка і збережені чернетки чекатимуть тут.</p>
          <Action action="resume" id={s.id}>
            Продовжити
          </Action>
        </div>
      ) : s.status === 'completed' ? (
        <div className="game-state deck-complete">
          <Heart size={36} aria-hidden="true" />
          <p className="eyebrow">Це було по-вашому</p>
          <h2>
            150 запитань.
            <br />
            Безліч відкриттів.
          </h2>
          <p>
            Ви подарували одне одному час. Збережіть ці розмови у вашій історії.
          </p>
          <p className="text-sm">
            Доступних тобі відповідей: {detail.answer_count}
          </p>
          <Button asChild>
            <a href="#game-history">Згадати наші відповіді</a>
          </Button>
          <Link className="text-sm underline" to="/us/connection/game">
            Запросити до нової гри
          </Link>
        </div>
      ) : ['closed', 'declined'].includes(s.status) ? (
        <div className="game-state">
          <Heart size={32} />
          <h2>
            {s.status === 'closed'
              ? 'Цю гру завершено'
              : 'Можливо, іншим разом'}
          </h2>
          <p>
            {s.status === 'closed'
              ? 'Твої збережені відповіді залишаються приватними.'
              : 'Запрошення не прийнято.'}
          </p>
          <Button asChild>
            <Link to="/us/connection/game">До наших ігор</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="game-table">
            <div className="game-card-stage">
              <ViewReceipt id={s.id} slot={cardAllowed ? s.position : 0}>
                <PlayingCard
                  key={s.position}
                  card={cardAllowed ? detail.card : null}
                  number={s.position}
                  remaining={detail.remaining}
                  initiallyBack={s.position === 0}
                />
              </ViewReceipt>
              <p className="game-card-hint">Натисни, щоб перевернути</p>
            </div>
            <div className="game-response">
              {s.position === 0 ? (
                <div className="game-state">
                  <h2>Тільки ви двоє</h2>
                  <p>Зручніше вмостіться. Першу картку відкриємо разом.</p>
                  <Action action="draw" id={s.id} expected={0}>
                    Витягнути першу картку
                  </Action>
                </div>
              ) : (
                <>
                  <div className="game-partner-status">
                    <ContextualStatus tone={both ? 'success' : 'quiet'}>
                      {both
                        ? 'Ви поділилися відповідями'
                        : waiting
                          ? 'Чекаємо на відповідь партнера'
                          : 'Кожен відповідає у своєму темпі'}
                    </ContextualStatus>
                    <Action
                      action="notify"
                      id={s.id}
                      expected={s.position}
                      variant="ghost"
                      ariaLabel="Надіслати партнеру"
                    >
                      <Send size={18} />
                    </Action>
                  </div>
                  {!cardAllowed && !own?.submitted ? (
                    <div className="space-y-3">
                      <p>Ця категорія зараз закрита.</p>
                      <Action
                        action="skip"
                        id={s.id}
                        expected={own?.version ?? 0}
                        payload={{ slot: String(s.position) }}
                        variant="outline"
                      >
                        Пропустити закрите запитання
                      </Action>
                    </div>
                  ) : !own?.submitted ? (
                    <CardAnswer
                      key={s.id + ':' + s.position + ':' + (own?.version ?? 0)}
                      detail={detail}
                    />
                  ) : null}
                  <Published detail={detail} />
                  {both && (
                    <Action action="draw" id={s.id} expected={s.position}>
                      {s.position === 150
                        ? 'Завершити колоду'
                        : 'Наступна картка'}
                    </Action>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
      {s.position > 0 && (
        <details
          id="game-history"
          className="quiet-details"
          open={s.status === 'completed' ? true : undefined}
        >
          <summary>Ваші попередні розмови</summary>
          <GameHistory id={s.id} />
        </details>
      )}
    </div>
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
    <section className="space-y-4">
      <label className="block text-sm font-medium">
        Твоя відповідь
        <textarea
          maxLength={2000}
          rows={4}
          placeholder="Те, чим хочеться поділитися…"
          {...register('answer')}
          className="connection-input"
        />
      </label>
      <div className="flex items-center justify-between gap-2">
        <Action
          action="save"
          id={s.id}
          expected={own?.version ?? 0}
          payload={{ slot: String(s.position), answers: values.answer }}
          variant="ghost"
        >
          Зберегти чернетку
        </Action>
        <small className="text-muted-foreground">
          {values.answer?.length ?? 0} / 2000
        </small>
      </div>
      <label className="consent-line">
        <input type="checkbox" {...register('publish')} />
        Дозволяю показати цю відповідь партнеру після участі обох
      </label>
      <div className="flex flex-wrap gap-3">
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
          variant="ghost"
        >
          Пропустити запитання
        </Action>
      </div>
    </section>
  )
}
function Published({ detail }: { detail: Detail }) {
  const { session } = useAuth()
  return (
    <section className="published-answers space-y-3" aria-live="polite">
      {detail.answers
        .filter(
          (a) =>
            a.submitted &&
            a.draft !== null &&
            (a.user_id === session?.user.id ||
              (['active', 'paused', 'completed'].includes(
                detail.session.status,
              ) &&
                !!detail.card &&
                (!['heat', 'secret'].includes(detail.card.category) ||
                  (detail.session.opt_a && detail.session.opt_b)))),
        )
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
export function QuestionnaireForm({ detail }: { detail: Detail }) {
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
    ['active', 'paused', 'completed'].includes(s.status) &&
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
          <details className="quiet-details">
            <summary>Як порівнюються відповіді</summary>
            <p>
              Для шкал порівнюється відстань 0–4, а для варіантів — їхній зміст.
              Це опис уподобань, не оцінка сумісності.
            </p>
          </details>
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
    <div lang="uk" className="game-scene">
      <PageHeader
        back="/us"
        eyebrow="Час для двох"
        title="Між нами"
        description="Одне запитання. Нова розмова."
        action={
          <OverflowMenu locale="uk" label="Про гру">
            <p>
              Це приклад оформлення. Для спільної колоди й приватних відповідей
              потрібні ваші облікові записи.
            </p>
          </OverflowMenu>
        }
      />
      <div className="game-table">
        <div>
          <PlayingCard card={catalog.cards[0]} number={1} remaining={149} />
          <p className="game-card-hint">Натисни, щоб перевернути</p>
        </div>
        <div className="game-state">
          <h2>А що б ти відповів(-ла)?</h2>
          <p>
            Спогади, маленькі зізнання, несподівані відкриття. По одній картці —
            у вашому темпі.
          </p>
          <ContextualStatus>Демо · лише перегляд картки</ContextualStatus>
          <Link className="back-link" to="/us/connection/questionnaires">
            Або обрати тему для розмови →
          </Link>
        </div>
      </div>
    </div>
  )
}
function ViewReceipt({
  id,
  slot,
  children,
}: {
  id: string
  slot: number
  children?: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null),
    seen = useRef(false),
    home = useConnection<Home>('home'),
    { client, session, online } = useAuth(),
    write = useConnectionWrite()
  const invited = home.data?.events.some(
    (e) => e.session_id === id && e.position === slot,
  )
  useEffect(() => {
    if (
      !invited ||
      !client ||
      !session ||
      !online ||
      seen.current ||
      !ref.current ||
      typeof IntersectionObserver === 'undefined'
    )
      return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((e) => e.isIntersecting) &&
          document.visibilityState === 'visible'
        ) {
          timer = setTimeout(() => {
            if (document.visibilityState !== 'visible' || seen.current) return
            seen.current = true
            write.mutate({
              action: 'ack',
              id,
              expected: slot,
              payload: {},
              request: crypto.randomUUID(),
            })
          }, 350)
        } else if (timer) clearTimeout(timer)
      },
      { threshold: 0.65 },
    )
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [invited, client, session, online, id, slot, write])
  return (
    <div ref={ref} className="view-receipt">
      {children}
    </div>
  )
}
function InvitedCard({ id, slot }: { id: string; slot: string }) {
  const q = useConnection<HistoryItem | null>('card-' + slot, id)
  return (
    <div className="space-y-4">
      <Feedback
        pending={q.isPending}
        error={q.error}
        retry={() => void q.refetch()}
      />
      {!q.isError && q.data ? (
        <>
          <ViewReceipt id={id} slot={Number(slot)}>
            <PlayingCard
              card={q.data.card}
              number={Number(slot)}
              remaining={0}
            />
          </ViewReceipt>
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
    </div>
  )
}
