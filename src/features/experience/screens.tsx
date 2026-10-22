import { Link } from 'react-router'
import { Coffee, Settings, Mountain, ArrowUpRight } from 'lucide-react'
import {
  PageHeader,
  FeatureEntry,
  GentleOnboarding,
  OverflowMenu,
  SectionHeader,
} from '../../components/experience'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { useAuth } from '../auth/auth-context'
import { useCouple } from '../couple/api'
import { CoupleStatus, CoupleScreen } from '../couple/screens'
import { TogetherProgress } from '../tasks/screens'
import { StatisticsSection, DemoStatistics } from '../statistics/screens'
import { RitualsSection, DemoRituals } from '../rituals/screens'
import { ConnectionLinks } from '../connection/screens'
import { useConnection } from '../connection/api'
import type { Home } from '../connection/model'
export function TodayFocus({
  pending = 0,
  hasPartner = true,
}: {
  pending?: number
  hasPartner?: boolean
}) {
  const { client } = useAuth()
  return client ? (
    <RealFocus pending={pending} hasPartner={hasPartner} />
  ) : (
    <Focus
      title="Сегодня можно просто побыть вместе"
      description="Начните с одного вопроса. Без планов на весь вечер — только вы и разговор."
      to="/us/connection/game"
      label="Выбрать вопрос"
    />
  )
}
function RealFocus({
  pending,
  hasPartner,
}: {
  pending: number
  hasPartner: boolean
}) {
  const home = useConnection<Home>('home'),
    event = !home.isError ? home.data?.events[0] : undefined,
    game = !home.isError ? home.data?.active_game_id : null
  if (event)
    return (
      <Focus
        title="Партнёр пригласил вас к разговору"
        description="Вас ждёт одна общая карта. Ответьте, когда будет удобно."
        to={
          '/us/connection/session/' +
          event.session_id +
          '?card=' +
          event.position
        }
        label="Открыть нашу карту"
      />
    )
  if (pending)
    return (
      <Focus
        title="Для вас есть предложение"
        description="Посмотрите, что партнёр хочет сделать вместе."
        to="/tasks"
        label="Посмотреть предложение"
      />
    )
  if (game)
    return (
      <Focus
        title="Продолжим наш разговор?"
        description="Ваша колода на том же месте. Можно начать с неё."
        to={'/us/connection/session/' + game}
        label="Продолжить игру"
      />
    )
  return (
    <Focus
      title={
        hasPartner
          ? 'Подарим друг другу немного времени?'
          : 'Ваше «мы» начинается здесь'
      }
      description={
        hasPartner
          ? 'Один вопрос, чашка чая и вы вдвоём. Выберите, что ближе сегодня.'
          : 'Создайте своё пространство и пригласите близкого человека.'
      }
      to={hasPartner ? '/us/connection/game' : '/us/settings'}
      label={hasPartner ? 'Выбрать вопрос' : 'Начать вместе'}
    />
  )
}
function Focus({
  title,
  description,
  to,
  label,
}: {
  title: string
  description: string
  to: string
  label: string
}) {
  return (
    <section className="today-focus">
      <p className="eyebrow">Маленькое время для нас</p>
      <h2>{title}</h2>
      <p>{description}</p>
      <Button asChild className="primary-action">
        <Link to={to}>
          {label} <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </Button>
    </section>
  )
}
export function UsOverview() {
  const { client } = useAuth()
  return (
    <div className="space-y-5">
      <PageHeader
        title="Мы"
        description="У каждого своя история. Здесь — то, что вы создаёте вместе."
        action={
          <OverflowMenu label="Настройки пары">
            <Button asChild variant="ghost">
              <Link to="/us/settings">
                <Settings size={17} />
                Пространство и профиль
              </Link>
            </Button>
          </OverflowMenu>
        }
      />
      {client ? (
        <PairWelcome />
      ) : (
        <Card className="duo-welcome">
          <div className="flex gap-2 mb-4">
            <span className="avatar">А</span>
            <span className="avatar">Б</span>
          </div>
          <h2>Ваше маленькое «мы»</h2>
          <p>Знакомьтесь с возможностями в своём темпе.</p>
        </Card>
      )}
      <GentleOnboarding id="us-intro" title="Не нужно начинать со всего сразу">
        Выберите одну игру или придумайте маленькую традицию. Остальное можно
        открыть позже.
      </GentleOnboarding>
      <FeatureEntry
        to="/us/history"
        icon={<Mountain />}
        title="Наша история"
        description="Совместный путь, тёплые моменты и достижения"
        accent="peach"
      />
      <section>
        <SectionHeader title="Пізнаємо одне одного" />
        <ConnectionLinks />
      </section>
      <FeatureEntry
        to="/us/traditions"
        icon={<Coffee />}
        title="Наші традиції"
        description="Ритуалы и привычки, к которым хочется возвращаться"
        accent="sage"
      />
    </div>
  )
}
function PairWelcome() {
  const q = useCouple()
  if (q.isPending || q.isError || !q.data || q.data.members.length !== 2)
    return <CoupleStatus />
  return (
    <Card className="duo-welcome">
      <div className="flex gap-2 mb-4">
        {q.data.profiles.map((p) => (
          <span className="avatar" key={p.id}>
            {p.display_name?.slice(0, 1) || '♡'}
          </span>
        ))}
      </div>
      <h2>
        {q.data.profiles
          .map((p) => p.display_name || 'Близкий человек')
          .join(' + ')}
      </h2>
      <p>Два равных голоса. Свой ритм.</p>
    </Card>
  )
}
export function UsHistory() {
  const { client } = useAuth()
  return (
    <div className="space-y-5">
      <PageHeader
        title="Наша история"
        description="Маленькие моменты, из которых складывается общее."
        back="/us"
      />
      {client ? <RealHistory /> : <DemoStatistics />}
    </div>
  )
}
function RealHistory() {
  const q = useCouple(),
    context =
      q.data?.members
        .map((m) => m.id)
        .sort()
        .join(':') ?? 'solo'
  return (
    <>
      <TogetherProgress />
      {!q.isPending && !q.isError && <StatisticsSection context={context} />}
    </>
  )
}
export function UsTraditions() {
  const { client } = useAuth()
  return (
    <div className="space-y-5">
      <PageHeader
        title="Наші традиції"
        description="Небольшое время вместе, которое становится привычным."
        back="/us"
      />
      {client ? <RitualsSection /> : <DemoRituals />}
    </div>
  )
}
export function UsSettings() {
  const { client } = useAuth()
  return (
    <div className="space-y-5">
      <PageHeader title="Ваше пространство" back="/us" />
      {client ? (
        <CoupleScreen />
      ) : (
        <Card>
          <h2 className="font-semibold">Здесь будут настройки вашей пары</h2>
          <p className="text-sm text-muted-foreground mt-2">
            В деморежиме нет аккаунтов и подключённых участников.
          </p>
        </Card>
      )}
    </div>
  )
}
export function DemoToday() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Рады видеть вас"
        title="Сегодня"
        description="Что хорошего мы можем сделать друг для друга?"
      />
      <TodayFocus />
      <div className="today-progress">
        <span>Наша история начинается с малого</span>
        <Link className="text-primary" to="/us/history">
          Посмотреть →
        </Link>
      </div>
      <section>
        <SectionHeader
          title="Немного заботы"
          action={
            <Link className="text-sm text-primary" to="/tasks">
              Все дела →
            </Link>
          }
        />
        <Link to="/tasks" className="demo-task-row">
          <span className="soft-check">♡</span>
          <div>
            <h3>Сделать утро чуть теплее</h3>
            <p>Небольшая идея для вас двоих</p>
          </div>
          <span>→</span>
        </Link>
      </section>
      <section>
        <SectionHeader
          title="Наши ритуалы"
          action={
            <Link className="text-sm text-primary" to="/us/traditions">
              Выбрать →
            </Link>
          }
        />
        <div className="ritual-strip">
          <Coffee size={24} />
          <div>
            <h3>Кофе без спешки</h3>
            <p>Пять минут только друг для друга</p>
          </div>
        </div>
      </section>
      <section>
        <SectionHeader title="Як ти сьогодні?" />
        <Link to="/us/connection/mood" className="mood-prompt">
          <span>☀️</span>
          <span>🌿</span>
          <span>🌧️</span>
          <span className="text-sm">Знайти хвилинку для себе →</span>
        </Link>
      </section>
      <GentleOnboarding id="today-intro" title="По одному маленькому шагу">
        Начните с того, что приятно вам обоим. Знакомиться со всеми
        возможностями сразу не нужно.
      </GentleOnboarding>
    </div>
  )
}
export function DemoGoalsExperience() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Мечтать вдвоём"
        title="Цели"
        description="Что хочется однажды назвать нашим?"
      />
      <div className="dream-example">
        <span>🏕️</span>
        <p className="eyebrow">Вдохновение</p>
        <h2>Выходные, которые запомним</h2>
        <p>
          Сменить обстановку. Найти новое любимое место. Побольше времени
          вдвоём.
        </p>
        <div className="compact-progress">
          <div>
            <span>Первый маленький шаг</span>
            <span>Выбрать место</span>
          </div>
          <div className="dream-line" />
        </div>
      </div>
      <Card>
        <h2 className="font-semibold">Какой будет ваша первая мечта?</h2>
        <p className="text-sm text-muted-foreground mt-2">
          В реальном пространстве вы предложите её партнёру и согласуете шаги
          вместе.
        </p>
      </Card>
    </div>
  )
}
export function DemoRewardsExperience() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Награды"
        description="Идеи маленьких радостей для двоих."
      />
      <div className="segmented-filters" aria-label="Пример каталога">
        <span className="px-3 py-2 text-sm">Вдохновение для ваших наград</span>
      </div>
      <div className="surface-grid">
        {[
          [
            '🍳',
            'Завтрак, который приготовят для тебя',
            'Медленное утро с любимым вкусом.',
          ],
          [
            '🎬',
            'Твой выбор кино на вечер',
            'Плед, что-нибудь вкусное — и никаких спойлеров.',
          ],
          ['🌷', 'Побачення-сюрприз', 'Маленький план с большой заботой.'],
        ].map(([emoji, title, copy]) => (
          <article className="reward-inspiration" key={title}>
            <span>{emoji}</span>
            <h2>{title}</h2>
            <p>{copy}</p>
            <small>Идея · вы определяете условия вместе</small>
          </article>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Примеры оформления. В деморежиме нет баланса и покупок.
      </p>
    </div>
  )
}
