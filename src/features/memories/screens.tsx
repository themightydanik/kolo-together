import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  Camera,
  Heart,
  Plus,
  ArrowUpRight,
  BookHeart,
  ImagePlus,
  Trash2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  PageHeader,
  OverflowMenu,
  ConfirmationDialog,
} from '../../components/experience'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { useAuth } from '../auth/auth-context'
import {
  useMemoryContext,
  useMemoryFeed,
  useMemoryDetail,
  useMemorySources,
  useMemoryWrite,
} from './api'
import {
  categories,
  memoryEditorSchema,
  memoryNoteSchema,
  memoryError,
  prettyDate,
  monthLabel,
  type MemoryDetail,
  type MemoryEditorValues,
  type MemoryIntent,
  type MemoryPhoto,
} from './model'
import { preparePhoto, photoDigest } from './images'

// Only an explicit discard/reload action may abandon a retained mutation intent.
function forgetMemoryIntent(
  cache: ReturnType<typeof useQueryClient>,
  ctx: ReturnType<typeof useMemoryContext>,
  action: string,
  id: string,
) {
  const key = `kolo:memory:${ctx.session?.user.id}:${ctx.context}:${action}:${id}`
  cache.removeQueries({ queryKey: ['memory-intent', key], exact: true })
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* browser storage may be blocked */
  }
}

export function MemoryAction({
  action,
  id = null,
  expected = 0,
  payload = {},
  children,
  onDone,
  disabled = false,
}: {
  action: string
  id?: string | null
  expected?: number
  payload?: MemoryIntent['payload']
  children: React.ReactNode
  disabled?: boolean
  onDone?: (id: string, intent: MemoryIntent) => void
}) {
  const ctx = useMemoryContext(),
    write = useMemoryWrite(),
    cache = useQueryClient(),
    key = `kolo:memory:${ctx.session?.user.id}:${ctx.context}:${action}:${id ?? 'new'}`,
    cacheKey = ['memory-intent', key]
  const [intent, setIntent] = useState<MemoryIntent | null>(() => {
      try {
        return (
          cache.getQueryData<MemoryIntent>(cacheKey) ??
          JSON.parse(sessionStorage.getItem(key) ?? 'null')
        )
      } catch {
        return null
      }
    }),
    [message, setMessage] = useState(''),
    [checking, setChecking] = useState(false)
  function retain(w: MemoryIntent | null) {
    setIntent(w)
    if (w) {
      cache.setQueryDefaults(['memory-intent'], { gcTime: Infinity })
      cache.setQueryData(cacheKey, w)
    } else cache.removeQueries({ queryKey: cacheKey, exact: true })
    try {
      if (w) sessionStorage.setItem(key, JSON.stringify(w))
      else sessionStorage.removeItem(key)
    } catch {
      /* cache retains original intent */
    }
  }
  async function send() {
    const w = intent ?? {
      action,
      id,
      expected,
      payload,
      request: crypto.randomUUID(),
    }
    retain(w)
    setMessage('')
    try {
      const r = await write.mutateAsync(w)
      retain(null)
      onDone?.(r.id, w)
    } catch (e) {
      setMessage(memoryError(e))
    }
  }
  async function inspect() {
    setChecking(true)
    try {
      const r = await ctx.client!.rpc('memory_inspect', {
        p_request: intent!.request,
      })
      if (r.error) throw r.error
      if (r.data) {
        const result = r.data as { id: string }
        retain(null)
        await cache.invalidateQueries({ queryKey: ['memory'] })
        await cache.invalidateQueries({ queryKey: ['memories'] })
        onDone?.(result.id, intent!)
      } else setMessage('Збереження не знайдено. Можна повторити ті самі дані.')
    } catch (e) {
      setMessage(memoryError(e))
    } finally {
      setChecking(false)
    }
  }
  return (
    <div className="space-y-2">
      <Button
        disabled={
          !ctx.enabled || write.isPending || checking || (disabled && !intent)
        }
        onClick={() => void send()}
      >
        {write.isPending
          ? 'Зберігаємо…'
          : intent
            ? 'Повторити той самий вибір'
            : children}
      </Button>
      {intent && !write.isPending && (
        <div className="memory-recovery">
          <p>Перевір попередню спробу перед новими змінами.</p>
          <Button
            variant="outline"
            disabled={!ctx.online || checking}
            onClick={() => void inspect()}
          >
            Перевірити збереження
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              retain(null)
              setMessage('')
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
export function MemoryPhotoView({
  id,
  alt = 'Фото зі спогаду',
  generation = 0,
  interactive = true,
}: {
  id: string
  alt?: string
  generation?: number
  interactive?: boolean
}) {
  const { client, context, online, couple, session } = useMemoryContext(),
    [state, setState] = useState({ key: '', url: '', error: false }),
    [attempt, setAttempt] = useState(0)
  const canRead =
      !!client && !!session && online && !couple.isPending && !couple.isError,
    key = [context, id, generation, attempt, canRead].join(':')
  useEffect(() => {
    let active = true,
      blobUrl = ''
    if (!canRead) return
    void client!.functions
      .invoke('memory-files', { body: { action: 'download', id } })
      .then((r) => {
        if (r.error || !(r.data instanceof Blob)) throw Error('unavailable')
        if (active) {
          blobUrl = URL.createObjectURL(r.data)
          setState({ key, url: blobUrl, error: false })
        }
      })
      .catch(() => {
        if (active) setState({ key, url: '', error: true })
      })
    return () => {
      active = false
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [client, context, id, canRead, generation, attempt, key])
  const current = state.key === key ? state : null
  return (
    <div className="memory-image">
      {current?.url ? (
        <img
          src={current.url}
          alt={alt}
          loading="lazy"
          onError={() => setState({ key, url: '', error: true })}
        />
      ) : current?.error ? (
        <div>
          <p>Фото зараз недоступне</p>
          {interactive && (
            <Button variant="ghost" onClick={() => setAttempt((x) => x + 1)}>
              Спробувати ще
            </Button>
          )}
        </div>
      ) : (
        <div role="img" aria-label="Завантаження фото">
          <Camera size={28} />
        </div>
      )}
    </div>
  )
}
export function MemoriesScreen() {
  const { client } = useAuth()
  return client ? <LiveMemories /> : <DemoMemories />
}
function DemoMemories() {
  return (
    <div className="memory-album">
      <PageHeader
        eyebrow="Маленьке життя для двох"
        title="Наша історія"
        description="Місце для моментів, які хочеться прожити ще раз."
        back="/us"
        action={
          <Button disabled>
            <Plus size={17} />
            Додати спогад
          </Button>
        }
      />
      <div className="memory-demo-note">
        Демоальбом · тут нічого не зберігається.
      </div>
      <section className="memory-empty">
        <div className="memory-stamp">
          <BookHeart size={40} />
        </div>
        <p className="eyebrow">Попереду стільки вашого</p>
        <h2>
          Одного дня ви скажете:
          <br />
          «Пам’ятаєш?..»
        </h2>
        <p>
          Перша подорож, випадкове побачення або звичайний ранок, який став
          особливим. Збережіть його тут, коли будете готові.
        </p>
      </section>
      <Link className="memory-progress-link" to="/us/progress">
        Наш шлях і досягнення <ArrowUpRight size={18} />
      </Link>
    </div>
  )
}
function LiveMemories() {
  const ctx = useMemoryContext(),
    [category, setCategory] = useState<string | null>(null),
    q = useMemoryFeed(category),
    [sources, setSources] = useState(location.search.includes('moments=1')),
    navigate = useNavigate(),
    cache = useQueryClient()
  const items = q.data?.pages.flatMap((p) => p.items) ?? [],
    createVersion = q.data?.pages[0]?.create_version ?? 0
  return (
    <div className="memory-album">
      <PageHeader
        eyebrow="Маленьке життя для двох"
        title="Наша історія"
        description="Місце для моментів, які хочеться прожити ще раз."
        back="/us"
        action={
          ctx.couple.data?.members.length === 2 ? (
            <MemoryAction
              action="create"
              expected={createVersion}
              onDone={(id) => navigate('/us/history/' + id + '?edit=1')}
            >
              <Plus size={17} />
              Додати спогад
            </MemoryAction>
          ) : undefined
        }
      />
      <div className="memory-album-tools">
        <Link to="/us/progress">
          Наш шлях і досягнення <ArrowUpRight size={16} />
        </Link>
        <Button
          variant="ghost"
          onClick={() => setSources((v) => !v)}
          aria-expanded={sources}
        >
          Зберегти особливий момент
        </Button>
      </div>
      {sources && (
        <SourcePicker
          expected={createVersion}
          onDone={(id) => navigate('/us/history/' + id + '?edit=1')}
        />
      )}
      <label className="memory-filter">
        Показати
        <select
          value={category ?? ''}
          onChange={(e) => setCategory(e.target.value || null)}
        >
          <option value="">Усі моменти</option>
          {Object.entries(categories).map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
      {!ctx.online ? (
        <Card>
          <p role="status">
            Зараз немає зв’язку. Спогади перевіримо після повернення мережі.
          </p>
        </Card>
      ) : !ctx.session || q.isError || ctx.couple.isError ? (
        <MemoryProblem
          error={q.error}
          retry={() => void cache.resetQueries({ queryKey: ['memories'] })}
        />
      ) : q.isPending && !q.data ? (
        <Card>
          <p role="status">Відкриваємо ваш альбом…</p>
        </Card>
      ) : (
        <>
          <div hidden={!ctx.enabled}>
            {!items.length && (
              <section className="memory-empty">
                <div className="memory-stamp">
                  <BookHeart size={40} />
                </div>
                <h2>
                  {category
                    ? 'У цій добірці поки тихо'
                    : 'Ваша історія починається з малого'}
                </h2>
                <p>
                  {ctx.couple.data?.members.length === 2
                    ? 'Додайте перший момент. Для початку достатньо назви й дати.'
                    : 'Запроси партнера у ваш простір, щоб почати спільну історію.'}
                </p>
                {ctx.couple.data?.members.length !== 2 && (
                  <Link to="/us/settings" className="text-primary underline">
                    До вашого простору
                  </Link>
                )}
              </section>
            )}
            {items.map((item, index) => {
              const heading = monthLabel(item.day),
                show =
                  index === 0 || heading !== monthLabel(items[index - 1].day)
              return (
                <section key={item.id} className="memory-month">
                  {show && <h2>{heading}</h2>}
                  <Link
                    className={
                      'memory-album-card ' + (!item.cover ? 'textual' : '')
                    }
                    to={'/us/history/' + item.id}
                  >
                    {item.cover ? (
                      <MemoryPhotoView
                        id={item.cover}
                        generation={0}
                        interactive={false}
                      />
                    ) : (
                      <div className="memory-paper-symbol" aria-hidden="true">
                        <Heart size={30} />
                      </div>
                    )}
                    <div className="memory-card-copy">
                      <time dateTime={item.day}>{prettyDate(item.day)}</time>
                      <h3>{item.title}</h3>
                      <p>
                        {item.status === 'draft'
                          ? 'Чернетка · тільки для тебе'
                          : item.status === 'private_note'
                            ? 'Особиста нотатка'
                            : item.status === 'withdrawn' ||
                                item.status === 'deleted'
                              ? 'Публікацію відкликано'
                              : item.category
                                ? categories[item.category]
                                : 'Мить вашого життя'}
                      </p>
                      <span>
                        Відкрити спогад <ArrowUpRight size={16} />
                      </span>
                    </div>
                  </Link>
                </section>
              )
            })}
            {q.hasNextPage && (
              <Button
                variant="outline"
                disabled={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                Раніші моменти
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
function SourcePicker({
  expected,
  onDone,
}: {
  expected: number
  onDone: (id: string) => void
}) {
  const q = useMemorySources(),
    ctx = useMemoryContext()
  if (!ctx.enabled || q.isError)
    return <p role="status">Моменти перевіримо після оновлення зв’язку.</p>
  return (
    <Card className="space-y-4">
      <h2>Особливе, що ви зробили разом</h2>
      <p className="text-sm text-muted-foreground">
        Останні спільні моменти. Тексти відповідей та настрої сюди не
        потрапляють.
      </p>
      {q.isPending ? (
        <p role="status">Шукаємо моменти…</p>
      ) : !q.data?.length ? (
        <p>
          Коли з’явиться ваш спільний підсумок, його можна буде зберегти тут.
        </p>
      ) : (
        q.data.map((s) => (
          <div key={s.kind + ':' + s.key} className="memory-source">
            <div>
              <h3>{s.source.title}</h3>
              <p>{prettyDate(s.source.date)}</p>
            </div>
            <MemoryAction
              action="create"
              expected={expected}
              payload={{ source_kind: s.kind, source_key: s.key }}
              onDone={onDone}
            >
              Зберегти у спогади
            </MemoryAction>
          </div>
        ))
      )}
    </Card>
  )
}
function MemoryProblem({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  return (
    <Card>
      <p role="alert">{memoryError(error)}</p>
      <Button variant="outline" className="mt-4" onClick={retry}>
        Оновити спогади
      </Button>
    </Card>
  )
}
export function MemoryDetailScreen() {
  const { client } = useAuth()
  return client ? <LiveDetail /> : <DemoMemories />
}
function LiveDetail() {
  const { memoryId = '' } = useParams(),
    q = useMemoryDetail(memoryId),
    ctx = useMemoryContext(),
    [editing, setEditing] = useState(location.search.includes('edit=1')),
    [editorRevision, setEditorRevision] = useState(0),
    cache = useQueryClient()
  if (!ctx.online)
    return (
      <Card>
        <p role="status">
          Зараз немає зв’язку. Збережені дані залишаються на сервері.
        </p>
      </Card>
    )
  if (!ctx.session || q.isError || ctx.couple.isError)
    return <MemoryProblem error={q.error} retry={() => void q.refetch()} />
  if (q.data && q.data.context !== ctx.context)
    return (
      <MemoryProblem
        error={Error('memory_context_changed')}
        retry={() => void q.refetch()}
      />
    )
  if (q.isPending || !q.data) return <p role="status">Відкриваємо спогад…</p>
  const d = q.data!,
    m = d.memory,
    author = m.author_id === ctx.session?.user.id,
    terminal = ['withdrawn', 'deleted', 'private_note'].includes(m.status)
  return (
    <div className="memory-full">
      <PageHeader
        title={
          m.title ||
          (m.status === 'private_note'
            ? 'Твоя особиста нотатка'
            : 'Новий спогад')
        }
        back="/us/history"
        description={m.event_date ? prettyDate(m.event_date) : undefined}
        action={
          author && !editing ? (
            <OverflowMenu locale="uk" label="Дії зі спогадом">
              {!terminal && (
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  Редагувати мій спогад
                </Button>
              )}
              {!terminal && (
                <ConfirmationDialog
                  locale="uk"
                  title="Відкликати публікацію?"
                  description="Спогад і фото більше не будуть спільними. Нотатка партнера залишиться лише в нього. Відновити цю публікацію не можна."
                  trigger={
                    <Button variant="ghost">Відкликати публікацію</Button>
                  }
                >
                  {(close) => (
                    <MemoryAction
                      action="withdraw"
                      id={m.id}
                      expected={m.version}
                      onDone={() => {
                        close()
                        void cleanup(ctx.client)
                      }}
                    >
                      Відкликати
                    </MemoryAction>
                  )}
                </ConfirmationDialog>
              )}
              <ConfirmationDialog
                locale="uk"
                title="Видалити моє змістове наповнення?"
                description="Твій текст і фото буде видалено. Чужа особиста нотатка збережеться без цих даних."
                trigger={<Button variant="ghost">Видалити мій спогад</Button>}
              >
                {(close) => (
                  <MemoryAction
                    action="delete"
                    id={m.id}
                    expected={m.version}
                    onDone={() => {
                      close()
                      void cleanup(ctx.client)
                    }}
                  >
                    Видалити мій текст і фото
                  </MemoryAction>
                )}
              </ConfirmationDialog>
            </OverflowMenu>
          ) : undefined
        }
      />
      <div hidden={!ctx.enabled}>
        {editing && author && !terminal ? (
          <MemoryEditor
            key={m.id + ':' + editorRevision}
            detail={d}
            refresh={() => setEditorRevision((v) => v + 1)}
            close={() => {
              setEditing(false)
              history.replaceState(null, '', '/us/history/' + m.id)
              void cache.invalidateQueries({ queryKey: ['memory'] })
            }}
          />
        ) : (
          <>
            {terminal ? (
              <Card>
                <p>
                  Публікацію відкликано. Власна нотатка залишається тільки для
                  тебе.
                </p>
              </Card>
            ) : (
              <>
                <div className="memory-gallery">
                  {d.photos
                    .filter((p) => p.position !== null)
                    .map((p) => (
                      <MemoryPhotoView key={p.id} id={p.id} />
                    ))}
                </div>
                {m.status === 'draft' && (
                  <p className="memory-draft-label">
                    Чернетка · бачиш тільки ти
                  </p>
                )}
                {m.story ? (
                  <p className="memory-story">{m.story}</p>
                ) : (
                  <div className="memory-quiet">
                    <Heart size={30} />
                    <p>Іноді достатньо просто пам’ятати цей день.</p>
                  </div>
                )}
                {d.source && (
                  <Link className="memory-source-link" to={d.source.path}>
                    Ваш спільний момент: {d.source.title}{' '}
                    <ArrowUpRight size={15} />
                  </Link>
                )}
              </>
            )}
            <section className="memory-notes">
              <h2>Кілька слів від кожного</h2>
              {d.notes
                .filter((n) => n.body)
                .map((n) => (
                  <Card key={n.user_id}>
                    <h3>
                      {n.user_id === ctx.session?.user.id
                        ? 'Твоя нотатка'
                        : 'Нотатка партнера'}
                    </h3>
                    <p className="whitespace-pre-wrap break-words">{n.body}</p>
                  </Card>
                ))}
              {m.status === 'published' ? (
                <NoteEditor key={'note-' + m.id} detail={d} />
              ) : (
                d.notes.some(
                  (n) => n.user_id === ctx.session?.user.id && n.body,
                ) && (
                  <MemoryAction
                    action="delete_note"
                    id={m.id}
                    expected={
                      d.notes.find((n) => n.user_id === ctx.session?.user.id)!
                        .version
                    }
                  >
                    Видалити мою нотатку
                  </MemoryAction>
                )
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
async function cleanup(client: ReturnType<typeof useAuth>['client']) {
  if (client)
    await client.functions.invoke('memory-files', {
      body: { action: 'cleanup' },
    })
}
function MemoryEditor({
  detail,
  close,
  refresh,
}: {
  detail: MemoryDetail
  close: () => void
  refresh: () => void
}) {
  const ctx = useMemoryContext(),
    m = detail.memory,
    [base] = useState(m.version ?? 1),
    form = useForm<MemoryEditorValues>({
      resolver: zodResolver(memoryEditorSchema),
      mode: 'onChange',
      defaultValues: {
        title: m.title ?? '',
        date: m.event_date ?? '',
        story: m.story ?? '',
        category: m.category ?? '',
      },
    }),
    [title, date, story, category] = useWatch({
      control: form.control,
      name: ['title', 'date', 'story', 'category'],
    }),
    [photos, setPhotos] = useState<MemoryPhoto[]>(
      detail.photos.filter((p) => p.position !== null),
    ),
    [staged] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [publish, setPublish] = useState(m.status === 'published'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [upload, setUpload] = useState<{
      id: string
      blob: Blob
      preview: string
    } | null>(null),
    cache = useQueryClient()
  useEffect(() => {
    void cleanup(ctx.client)
  }, [ctx.client])
  useEffect(
    () => () => {
      if (upload?.preview) URL.revokeObjectURL(upload.preview)
    },
    [upload],
  )
  async function uploadFile(job: { id: string; blob: Blob; preview: string }) {
    setBusy(true)
    setError('')
    try {
      const digest = await photoDigest(job.blob),
        reserved = await ctx.client!.rpc('memory_file', {
          p_action: 'reserve',
          p_id: m.id,
          p_payload: {
            id: job.id,
            mime: job.blob.type,
            bytes: job.blob.size,
            digest,
          },
        })
      if (reserved.error) throw reserved.error
      const form = new FormData()
      form.set('id', job.id)
      form.set('file', job.blob, 'photo.jpg')
      const r = await ctx.client!.functions.invoke('memory-files', {
        body: form,
      })
      if (r.error) throw r.error
      staged.push(job.id)
      setPhotos((old) =>
        old.some((p) => p.id === job.id)
          ? old
          : [
              ...old,
              {
                id: job.id,
                mime: job.blob.type,
                bytes: job.blob.size,
                state: 'ready',
                position: null,
              },
            ],
      )
      setUpload(null)
    } catch {
      setError(
        'Не вдалося завантажити фото. Можна повторити саме це завантаження.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function choose(file?: File) {
    if (!file) return
    setError('')
    setBusy(true)
    try {
      const blob = await preparePhoto(file),
        job = {
          id: crypto.randomUUID(),
          blob,
          preview: URL.createObjectURL(blob),
        }
      setUpload(job)
      await uploadFile(job)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося підготувати фото.')
    } finally {
      setBusy(false)
    }
  }
  async function discardUpload() {
    if (!upload) return
    setBusy(true)
    await ctx.client!.rpc('memory_file', {
      p_action: 'discard',
      p_id: upload.id,
      p_payload: {},
    })
    await cleanup(ctx.client)
    setUpload(null)
    setError('')
    setBusy(false)
  }
  async function cancel() {
    setBusy(true)
    for (const id of [...staged, ...(upload ? [upload.id] : [])])
      await ctx.client!.rpc('memory_file', {
        p_action: 'discard',
        p_id: id,
        p_payload: {},
      })
    await cleanup(ctx.client)
    setBusy(false)
    close()
  }
  const valid =
    memoryEditorSchema.safeParse({ title, date, story, category }).success &&
    (!publish || confirmed) &&
    !busy &&
    !upload
  return (
    <section className="memory-editor">
      {m.version !== base && (
        <Card>
          <p role="status">
            Спогад змінився в іншому вікні. Твій чернетковий текст і фото
            збережені тут. Перед новим збереженням переглянь актуальну версію.
          </p>
          <ConfirmationDialog
            locale="uk"
            title="Оновити збережені дані?"
            description="Незбережені зміни цієї форми буде замінено актуальною серверною версією. Нові фото залишаться приватними тимчасовими завантаженнями до очищення."
            trigger={<Button variant="outline">Оновити збережені дані</Button>}
          >
            <Button
              onClick={() => {
                forgetMemoryIntent(cache, ctx, 'save', m.id)
                refresh()
              }}
            >
              Відкинути чернетку й оновити
            </Button>
          </ConfirmationDialog>
        </Card>
      )}
      <p className="memory-draft-label">
        {m.status === 'published'
          ? 'Зміни стануть спільними після збереження.'
          : 'Чернетка · бачиш тільки ти'}
      </p>
      <label>
        Назва
        <input maxLength={120} {...form.register('title')} required />
      </label>
      <label>
        Дата моменту
        <input
          type="date"
          min="1900-01-01"
          max="2200-12-31"
          {...form.register('date')}
          required
        />
      </label>
      <label>
        Твоя історія <span>необов’язково</span>
        <textarea maxLength={5000} rows={6} {...form.register('story')} />
      </label>
      <label>
        Категорія
        <select {...form.register('category')}>
          <option value="">Без категорії</option>
          {Object.entries(categories).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <div className="memory-editor-photos">
        {photos.map((p) => (
          <div key={p.id}>
            <MemoryPhotoView id={p.id} />
            <Button
              variant="ghost"
              aria-label="Прибрати фото зі спогаду"
              onClick={() =>
                setPhotos((old) => old.filter((x) => x.id !== p.id))
              }
            >
              <Trash2 size={17} />
            </Button>
          </div>
        ))}
      </div>
      {photos.length < 5 && !upload && (
        <label className="memory-add-photo">
          <ImagePlus size={20} />
          Додати фото <span>JPEG, PNG, WebP · до 10 МБ · максимум 5</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              void choose(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      )}
      {upload && (
        <div className="memory-upload-preview">
          <img src={upload.preview} alt="Попередній перегляд нового фото" />
          {busy ? (
            <p role="status">Готуємо фото…</p>
          ) : (
            <>
              <Button onClick={() => void uploadFile(upload)}>
                Повторити завантаження фото
              </Button>
              <Button variant="ghost" onClick={() => void discardUpload()}>
                Прибрати нове фото
              </Button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {m.status === 'draft' && (
        <label className="memory-checkbox">
          <input
            type="checkbox"
            checked={publish}
            onChange={(e) => setPublish(e.target.checked)}
          />
          Опублікувати для нас обох
        </label>
      )}
      {publish && (
        <label className="memory-checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Підтверджую публікацію мого тексту й цих фото для партнера
        </label>
      )}
      <div className="memory-editor-actions">
        {
          <MemoryAction
            disabled={!valid}
            action="save"
            id={m.id}
            expected={base}
            payload={{
              title,
              date,
              story,
              category: category || null,
              photos: photos.map((p) => p.id),
              publish,
              confirmed,
            }}
            onDone={() => {
              void cleanup(ctx.client)
              void cache.invalidateQueries({ queryKey: ['memory'] })
              close()
            }}
          >
            Зберегти спогад
          </MemoryAction>
        }
        <Button variant="outline" disabled={busy} onClick={() => void cancel()}>
          Скасувати зміни
        </Button>
      </div>
    </section>
  )
}
function NoteEditor({ detail }: { detail: MemoryDetail }) {
  const ctx = useMemoryContext(),
    { session } = ctx,
    cache = useQueryClient(),
    own = detail.notes.find((n) => n.user_id === session?.user.id),
    [base, setBase] = useState(own?.version ?? 0),
    form = useForm({
      resolver: zodResolver(memoryNoteSchema),
      mode: 'onChange',
      defaultValues: { body: own?.body ?? '' },
    }),
    body = useWatch({ control: form.control, name: 'body' })
  return (
    <div className="memory-note-editor">
      {(own?.version ?? 0) !== base && (
        <p role="status">
          Нотатка змінилася в іншому вікні. Твій текст не замінено.{' '}
          <Button
            variant="ghost"
            onClick={() => {
              forgetMemoryIntent(cache, ctx, 'note', detail.memory.id)
              form.reset({ body: own?.body ?? '' })
              setBase(own?.version ?? 0)
            }}
          >
            Завантажити збережену нотатку
          </Button>
        </p>
      )}
      <label>
        Твоя особиста нотатка
        <textarea {...form.register('body')} rows={3} maxLength={3000} />
      </label>
      <p>
        У спільному спогаді її бачить партнер. Змінити твої слова можеш тільки
        ти.
      </p>
      <MemoryAction
        action="note"
        id={detail.memory.id}
        expected={base}
        payload={{ body }}
        onDone={(_id, intent) => setBase(intent.expected + 1)}
        disabled={!memoryNoteSchema.safeParse({ body }).success}
      >
        Зберегти мою нотатку
      </MemoryAction>
      {own?.body && (
        <MemoryAction
          action="delete_note"
          id={detail.memory.id}
          expected={own.version}
          onDone={(_id, intent) => {
            setBase(intent.expected + 1)
            form.reset({ body: '' })
          }}
        >
          Видалити мою нотатку
        </MemoryAction>
      )}
    </div>
  )
}
