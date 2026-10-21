import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Sparkles, TrendingUp, CalendarDays, History } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { ErrorState, LoadingState } from '../../components/states'
import { useAuth } from '../auth/auth-context'
import { useJointHistory, useStatistics } from './api'
import {
  badgeInfo,
  historyLink,
  utcDate,
  type Badge,
  type Statistics,
} from './model'
import { errorMessage } from '../../lib/errors'
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-muted p-4">
      <p className="text-2xl font-semibold tabular-nums">
        {value.toLocaleString('ru-RU')}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
export function BadgeCard({ badge }: { badge: Badge }) {
  const [emoji, title, description] = badgeInfo(badge.code)
  const open = badge.progress >= badge.threshold
  return (
    <article
      className={`rounded-2xl border p-4 ${open ? 'border-primary/25 bg-primary/5' : 'border-border bg-muted/30 text-muted-foreground'}`}
    >
      <span className="text-2xl" aria-hidden="true">
        {emoji}
      </span>
      <h4 className="mt-2 font-semibold">{title}</h4>
      <p className="my-2 text-xs">{description}</p>
      <p className="text-xs">
        {open ? 'Открыто' : 'Ещё не открыто'}
        {open && badge.unlocked_at
          ? ` · ${utcDate(badge.unlocked_at)} UTC`
          : ''}
      </p>
      {!open && (
        <>
          <progress
            className="mt-3 h-2 w-full accent-primary"
            aria-label={`Прогресс: ${title}`}
            max={badge.threshold}
            value={Math.min(badge.progress, badge.threshold)}
          />
          <p className="text-xs tabular-nums">
            {Math.min(badge.progress, badge.threshold)} / {badge.threshold}
          </p>
        </>
      )}
      {badge.scope === 'space' && (
        <p className="mt-2 text-xs">
          История пространства, включая прежних участников. Дата не
          восстанавливается.
        </p>
      )}
    </article>
  )
}
export function StatisticsCards({ data }: { data: Statistics }) {
  return (
    <>
      <Card className="hero">
        <div className="flex items-center gap-2">
          <TrendingUp aria-hidden="true" />
          <h2 className="text-xl font-semibold">Наш совместный путь</h2>
        </div>
        <p className="mt-4 text-4xl font-semibold tabular-nums">
          {data.shared.together_xp.toLocaleString('ru-RU')}{' '}
          <span className="text-base">Together XP</span>
        </p>
        <p className="mt-3 text-sm">
          Итог пространства сохраняется при смене состава. Это память о пути, а
          не сравнение партнёров.
        </p>
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">Статистика</h2>
        <h3 className="mb-3 text-sm text-muted-foreground">
          Только ваши показатели
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Личные XP" value={data.personal.xp} />
          <Metric label="Текущий остаток Coins" value={data.personal.coins} />
          <Metric
            label="Собственных выполнений заданий"
            value={data.personal.tasks}
          />
          <Metric
            label="Личных достижений"
            value={data.personal.achievements}
          />
        </div>
        <h3 className="mb-3 mt-6 text-sm text-muted-foreground">
          Доступная история нынешних участников
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Включает прошлые периоды участия этих же людей. История с другими
          партнёрами скрыта; без подключённого партнёра общие действия не
          показываются.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Совместных заданий" value={data.shared.tasks} />
          <Metric label="Достигнутых целей" value={data.shared.goals} />
          <Metric
            label="Общих достижений, включая XP пространства"
            value={data.shared.achievements}
          />
        </div>
      </Card>
      <Card>
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          <CalendarDays size={20} aria-hidden="true" />В вашем ритме · UTC
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Активный день — хотя бы одно собственное выполнение задания. Пропуски
          ничего не отнимают. Сегодня без активности? Вчерашняя серия пока
          сохраняется.
        </p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt>Текущая серия</dt>
            <dd className="font-semibold">{data.streak.current} дн.</dd>
          </div>
          <div>
            <dt>Лучшая серия</dt>
            <dd className="font-semibold">{data.streak.best} дн.</dd>
          </div>
          <div>
            <dt>Активных дней за 7 дней</dt>
            <dd>{data.activity.days7}</dd>
          </div>
          <div>
            <dt>За 30 дней</dt>
            <dd>{data.activity.days30}</dd>
          </div>
        </dl>
        <h3 className="mb-3 mt-6 text-sm">
          Собственные выполнения по дням · последние 30 дней
        </h3>
        <ol
          className="grid grid-cols-7 gap-2"
          aria-label="Календарь активности UTC"
        >
          {data.calendar.map((day) => (
            <li
              key={day.day}
              className={`rounded-lg p-2 text-center text-xs ${day.actions ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}
            >
              <time dateTime={day.day}>{day.day.slice(8)}</time>
              <span className="sr-only"> {utcDate(day.day)} UTC:</span>
              <span
                className="mt-1 block font-semibold"
                aria-label={`${day.actions} выполнений`}
              >
                {day.actions}
              </span>
            </li>
          ))}
        </ol>
        {data.shared.xp_series_complete ? (
          <>
            <h3 className="mb-3 mt-6 text-sm">
              Накопление Together XP · 30 дней, UTC
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
              До начала периода:{' '}
              {data.shared.opening_together_xp.toLocaleString('ru-RU')} Together
              XP. Значения включают этот накопленный опыт.
            </p>
            <div
              className="flex h-24 items-end gap-1"
              role="img"
              aria-label="График накопленного Together XP по дням"
            >
              {data.calendar.map((day) => (
                <div
                  key={day.day}
                  className="flex-1 rounded-t bg-primary/60"
                  style={{
                    height: `${Math.max(2, (day.cumulative_xp / Math.max(1, data.shared.together_xp)) * 100)}%`,
                  }}
                  title={`${day.day} UTC: ${day.cumulative_xp} Together XP`}
                />
              ))}
            </div>
            <details className="mt-3 text-xs">
              <summary>Значения графика</summary>
              <ul>
                {data.calendar.map((day) => (
                  <li key={day.day}>
                    {day.day} UTC: {day.cumulative_xp} Together XP
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <p className="mt-5 text-xs text-muted-foreground">
            Полный график XP недоступен: итог включает историю вне доступных
            событий. Мы не восстанавливаем скрытые даты и действия.
          </p>
        )}
      </Card>
      <Card>
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          <Sparkles size={20} aria-hidden="true" />
          Достижения
        </h2>
        <p className="mb-5 text-sm text-muted-foreground">
          Памятные отметки без дополнительных XP и Coins. Исторические
          выполнения тоже учитываются.
        </p>
        {(['personal', 'shared', 'space'] as const).map((scope) => (
          <div key={scope} className="mt-5">
            <h3 className="mb-3 text-sm font-semibold">
              {scope === 'personal'
                ? 'Личные · видны только вам'
                : scope === 'shared'
                  ? 'Нынешние участники'
                  : 'История пространства'}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.badges
                .filter((b) => b.scope === scope)
                .map((badge) => (
                  <BadgeCard key={badge.code} badge={badge} />
                ))}
            </div>
          </div>
        ))}
      </Card>
    </>
  )
}
const delivered = new Set<string>()
function Congratulations({ data }: { data: Statistics }) {
  const { client, session, online } = useAuth()
  const [codes, setCodes] = useState<string[]>([])
  useEffect(() => {
    if (!client || !session || !online) return
    const user = session.user.id
    // Server serializes acknowledgement. No client-provided codes or unlocks.
    void Promise.resolve(client.rpc('acknowledge_statistics'))
      .then((result) => {
        if (result.error || !result.data) return
        const fresh = result.data.filter(
          (code) => !delivered.has(`${user}:${code}`),
        )
        fresh.forEach((code) => delivered.add(`${user}:${code}`))
        if (fresh.length) setCodes(fresh)
      })
      .catch(() => {
        /* A lost acknowledgement may suppress a greeting; it never creates an unlock. */
      })
  }, [client, session, online, data.as_of])
  return codes.length ? (
    <Card>
      <p role="status">
        Новая памятная отметка:{' '}
        {codes.map((code) => badgeInfo(code)[1]).join(', ')}. Спасибо за ваши
        маленькие шаги!
      </p>
      <Button variant="ghost" onClick={() => setCodes([])}>
        Продолжить
      </Button>
    </Card>
  ) : null
}
export function JointHistory({ context }: { context: string }) {
  const query = useJointHistory(context)
  const cache = useQueryClient()
  const items = query.isError
    ? []
    : (query.data?.pages.flatMap((page) => page.items) ?? [])
  return (
    <Card>
      <h2 className="mb-4 flex items-center gap-2 font-semibold">
        <History size={20} aria-hidden="true" />
        История совместного пути
      </h2>
      <Button
        variant="ghost"
        onClick={() => {
          void cache.resetQueries({ queryKey: ['joint-history'] })
        }}
      >
        Обновить с начала
      </Button>
      <p className="mb-4 text-xs text-muted-foreground">
        Даты UTC. Только доступные события нынешних участников. Достижения XP
        пространства без достоверной даты не входят в хронологию.
      </p>
      {query.isPending ? (
        <LoadingState />
      ) : (
        <>
          {!items.length && !query.isError && (
            <p className="py-6 text-sm text-muted-foreground">
              Пока здесь тихо. Совместные выполнения и достигнутые цели появятся
              в вашей истории.
            </p>
          )}
          <ol className="space-y-4">
            {items.map((item) => {
              const info =
                item.kind === 'achievement'
                  ? badgeInfo(item.title)
                  : [
                      item.kind === 'goal'
                        ? '🌈'
                        : item.kind === 'reward'
                          ? '🎁'
                          : '🤝',
                      item.title,
                    ]
              const link = historyLink(item)
              return (
                <li
                  key={item.key}
                  className="flex gap-3 border-b border-border pb-4"
                >
                  <span aria-hidden="true">{info[0]}</span>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {item.kind === 'task'
                        ? 'Совместное задание завершено'
                        : item.kind === 'goal'
                          ? 'Цель достигнута'
                          : item.kind === 'reward'
                            ? 'Награда получена и подтверждена'
                            : 'Достижение открыто'}
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {link ? (
                        <Link
                          className="text-primary underline-offset-4 hover:underline"
                          to={link}
                        >
                          {info[1]}
                        </Link>
                      ) : (
                        info[1]
                      )}
                    </p>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={item.at}
                    >
                      {utcDate(item.at)} UTC
                    </time>
                  </div>
                </li>
              )
            })}
          </ol>
          {query.isError && (
            <div role="alert" className="mt-4">
              <p>{errorMessage(query.error)}</p>
              <Button
                variant="outline"
                onClick={() => {
                  void cache.resetQueries({ queryKey: ['joint-history'] })
                }}
              >
                Обновить историю с начала
              </Button>
            </div>
          )}
          {query.hasNextPage && !query.isError && (
            <Button
              className="mt-4"
              variant="outline"
              disabled={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage()
              }}
            >
              {query.isFetchingNextPage ? 'Загружаем…' : 'Ещё 20 событий'}
            </Button>
          )}
        </>
      )}
    </Card>
  )
}
export function StatisticsSection({ context }: { context: string }) {
  const query = useStatistics(context)
  if (query.isPending)
    return (
      <div
        role="status"
        aria-label="Загружаем статистику"
        className="space-y-4"
      >
        <span className="sr-only">Загружаем статистику…</span>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            aria-hidden="true"
            className="h-32 animate-pulse rounded-3xl bg-muted motion-reduce:animate-none"
          />
        ))}
      </div>
    )
  if (query.isError)
    return (
      <Card>
        <ErrorState
          retry={() => {
            void query.refetch()
          }}
        />
      </Card>
    )
  return (
    <>
      <Congratulations data={query.data} />
      <StatisticsCards data={query.data} />
      <JointHistory key={query.data.context} context={query.data.context} />
    </>
  )
}
export function DemoStatistics() {
  return (
    <Card>
      <h2 className="text-xl font-semibold">Достижения и наш путь</h2>
      <p className="my-3 text-sm text-muted-foreground">
        Демонстрационный пример. Серверных балансов и открытых достижений здесь
        нет.
      </p>
      <div className="rounded-2xl bg-muted p-4">
        <span aria-hidden="true">🤝</span>
        <h3 className="mt-2 font-semibold">Первый шаг вместе</h3>
        <p className="text-sm">
          Пример условия: первое полностью завершённое совместное задание.
          Подключите Supabase и войдите, чтобы увидеть собственную историю.
        </p>
      </div>
    </Card>
  )
}
