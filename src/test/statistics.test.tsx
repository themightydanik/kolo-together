// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import {
  StatisticsCards,
  StatisticsSection,
  BadgeCard,
  DemoStatistics,
} from '../features/statistics/screens'
import {
  catalogue,
  historyLink,
  utcDate,
  type Statistics,
} from '../features/statistics/model'
const auth = vi.hoisted(() => ({
  client: { rpc: vi.fn() },
  session: { user: { id: 'own' } },
  online: true,
}))
vi.mock('../features/auth/auth-context', () => ({ useAuth: () => auth }))
function snapshot(): Statistics {
  return {
    as_of: '2026-10-20T10:00:00Z',
    timezone: 'UTC',
    context: 'a:b',
    personal: { xp: 20, coins: 5, tasks: 1, achievements: 1 },
    shared: {
      together_xp: 70,
      tasks: 1,
      goals: 1,
      achievements: 3,
      opening_together_xp: 0,
      xp_series_complete: true,
    },
    streak: { current: 1, best: 1 },
    activity: { days7: 1, days30: 1 },
    calendar: Array.from({ length: 30 }, (_, i) => ({
      day: new Date(Date.UTC(2026, 9, i + 1)).toISOString().slice(0, 10),
      actions: i === 29 ? 1 : 0,
      together_xp: i === 29 ? 70 : 0,
      cumulative_xp: i === 29 ? 70 : 0,
    })),
    badges: [
      {
        code: 'personal_1',
        scope: 'personal',
        metric: 'personal',
        threshold: 1,
        progress: 1,
        unlocked_at: '2026-10-20T10:00:00Z',
      },
      {
        code: 'joint_5',
        scope: 'shared',
        metric: 'task',
        threshold: 5,
        progress: 1,
        unlocked_at: null,
      },
      {
        code: 'together_20',
        scope: 'space',
        metric: 'xp',
        threshold: 20,
        progress: 70,
        unlocked_at: null,
      },
    ],
  }
}
function mount(node: React.ReactNode) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const result = render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...result, cache }
}
beforeEach(() => {
  auth.online = true
  auth.client.rpc.mockReset()
  auth.client.rpc.mockImplementation((fn: string) =>
    Promise.resolve({
      data:
        fn === 'get_statistics'
          ? snapshot()
          : fn === 'get_joint_history'
            ? { items: [], next_cursor: null, context: 'a:b' }
            : [],
      error: null,
    }),
  )
})
afterEach(cleanup)
test('statistics renders server balances, private metrics, UTC calendar and accessible XP graph', () => {
  mount(<StatisticsCards data={snapshot()} />)
  expect(screen.getByText('Текущий остаток Coins')).toBeInTheDocument()
  expect(screen.getByText('Только ваши показатели')).toBeInTheDocument()
  expect(screen.getAllByText(/UTC/).length).toBeGreaterThan(1)
  expect(
    screen.getByRole('list', { name: 'Календарь активности UTC' }).children,
  ).toHaveLength(30)
  expect(
    screen.getByRole('img', { name: /накопленного Together XP/ }),
  ).toBeInTheDocument()
  expect(screen.queryByText(/кто сделал больше/i)).not.toBeInTheDocument()
})
test('closed badge has actual progress and historical space badge has no invented unlock date', () => {
  const data = snapshot()
  mount(
    <>
      <BadgeCard badge={data.badges[1]} />
      <BadgeCard badge={data.badges[2]} />
    </>,
  )
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1')
  expect(screen.getByText('1 / 5')).toBeInTheDocument()
  expect(screen.getByText(/Дата не восстанавливается/)).toBeInTheDocument()
  expect(screen.getAllByText('Открыто')).toHaveLength(1)
})
test('new partner cannot get a fabricated timeline graph from historical aggregate XP', () => {
  const data = snapshot()
  data.shared.xp_series_complete = false
  mount(<StatisticsCards data={data} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText(/Полный график XP недоступен/)).toBeInTheDocument()
})
test('server pagination passes exact cursor and never requests all historical rows', async () => {
  const cursor = {
    session: 'opaque',
    badges: [],
    at: '2026-10-20T10:00:00Z',
    key: 'task:one',
  }
  auth.client.rpc.mockImplementation(
    (fn: string, args?: { p_cursor: unknown }) =>
      Promise.resolve({
        data:
          fn === 'get_statistics'
            ? snapshot()
            : fn === 'get_joint_history'
              ? {
                  context: 'a:b',
                  items: [
                    {
                      key: args?.p_cursor ? 'goal:two' : 'task:one',
                      kind: args?.p_cursor ? 'goal' : 'task',
                      title: args?.p_cursor ? 'Наша мечта' : 'Наша забота',
                      object_id: 'object',
                      at: cursor.at,
                    },
                  ],
                  next_cursor: args?.p_cursor ? null : cursor,
                }
              : [],
        error: null,
      }),
  )
  mount(<StatisticsSection context="a:b" />)
  expect(await screen.findByText('Наша забота')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ещё 20 событий' }))
  expect(await screen.findByText('Наша мечта')).toHaveAttribute(
    'href',
    '/goals/object',
  )
  expect(auth.client.rpc).toHaveBeenCalledWith('get_joint_history', {
    p_cursor: cursor,
    p_limit: 20,
  })
  expect(screen.getAllByText('Наша забота')).toHaveLength(1)
  expect(
    screen.queryByRole('button', { name: 'Ещё 20 событий' }),
  ).not.toBeInTheDocument()
})
test('empty workspace has a real empty state; first acknowledgement stays silent', async () => {
  mount(<StatisticsSection context="a:b" />)
  expect(await screen.findByText(/Пока здесь тихо/)).toBeInTheDocument()
  await waitFor(() =>
    expect(auth.client.rpc).toHaveBeenCalledWith('acknowledge_statistics'),
  )
  expect(screen.queryByText(/Новая памятная отметка/)).not.toBeInTheDocument()
})
test('congratulations comes only from server acknowledgement and not from cached unlocked badges', async () => {
  let first = true
  auth.client.rpc.mockImplementation((fn: string) =>
    Promise.resolve({
      data:
        fn === 'get_statistics'
          ? snapshot()
          : fn === 'get_joint_history'
            ? { items: [], next_cursor: null, context: 'a:b' }
            : first
              ? ((first = false), ['joint_1'])
              : [],
      error: null,
    }),
  )
  const rendered = mount(<StatisticsSection context="a:b" />)
  expect(await screen.findByText(/Новая памятная отметка/)).toHaveTextContent(
    'Первый шаг вместе',
  )
  rendered.unmount()
  mount(<StatisticsSection context="a:b" />)
  expect(await screen.findByText(/Пока здесь тихо/)).toBeInTheDocument()
  expect(screen.queryByText(/Новая памятная отметка/)).not.toBeInTheDocument()
})
test('loading and safe errors never display SQL details, retry remains available', async () => {
  auth.client.rpc.mockResolvedValue({
    data: null,
    error: { message: 'relation internal_sql does not exist' },
  })
  mount(<StatisticsSection context="a:b" />)
  expect(screen.getByRole('status')).toBeInTheDocument()
  expect(await screen.findByRole('alert')).not.toHaveTextContent('internal_sql')
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
})
test('membership epoch changes invalidate client history key and discard previous pages', async () => {
  auth.client.rpc.mockImplementation((fn: string) =>
    Promise.resolve({
      data:
        fn === 'get_statistics'
          ? snapshot()
          : fn === 'get_joint_history'
            ? {
                items: [
                  {
                    key: 'task:old',
                    kind: 'task',
                    title: 'Прежняя история',
                    object_id: 'x',
                    at: '2026-10-20T00:00:00Z',
                  },
                ],
                next_cursor: null,
                context: 'a:b',
              }
            : [],
      error: null,
    }),
  )
  const { rerender, cache } = mount(<StatisticsSection context="a:b" />)
  expect(await screen.findByText('Прежняя история')).toBeInTheDocument()
  auth.client.rpc.mockImplementation((fn: string) =>
    Promise.resolve({
      data:
        fn === 'get_statistics'
          ? { ...snapshot(), context: 'a:c' }
          : fn === 'get_joint_history'
            ? { items: [], next_cursor: null, context: 'a:c' }
            : [],
      error: null,
    }),
  )
  rerender(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <StatisticsSection context="a:c" />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(await screen.findByText(/Пока здесь тихо/)).toBeInTheDocument()
  expect(screen.queryByText('Прежняя история')).not.toBeInTheDocument()
})
test('catalogue codes are fixed; XP titles never claim a count of actions; UTC formatting independent of offset', () => {
  expect(Object.keys(catalogue)).toHaveLength(13)
  expect(catalogue.together_100[1]).toContain('XP')
  expect(utcDate('2026-10-20T23:30:00-04:00')).toBe('21.10.2026')
  expect(
    historyLink({
      kind: 'achievement',
      at: '',
      key: '',
      title: '',
      object_id: null,
    }),
  ).toBeNull()
})
test('demo labels examples without a simulated balance or unlock', () => {
  mount(<DemoStatistics />)
  expect(screen.getByText(/Демонстрационный пример/)).toBeInTheDocument()
  expect(screen.queryByText('Открыто')).not.toBeInTheDocument()
  expect(auth.client.rpc).not.toHaveBeenCalled()
})
test('XP chart labels the pre-window balance and preserves it on days without new grants', () => {
  const data = snapshot()
  data.shared.opening_together_xp = 20
  data.shared.together_xp = 90
  data.calendar = data.calendar.map((d) => ({
    ...d,
    cumulative_xp: d.cumulative_xp + 20,
  }))
  mount(<StatisticsCards data={data} />)
  expect(
    screen.getByText(/До начала периода: 20 Together XP/),
  ).toBeInTheDocument()
  expect(screen.getByTitle('2026-10-01 UTC: 20 Together XP')).toHaveStyle({
    height: `${(20 / 90) * 100}%`,
  })
})
test('retained page hides old object names when server rejects the cursor', async () => {
  let more = false
  auth.client.rpc.mockImplementation((fn: string) =>
    Promise.resolve(
      fn === 'get_statistics'
        ? { data: snapshot(), error: null }
        : fn === 'get_joint_history'
          ? more
            ? { data: null, error: { message: 'invalid_statistics_cursor' } }
            : {
                data: {
                  context: 'a:b',
                  items: [
                    {
                      at: '2026-10-20T10:00:00Z',
                      key: 'task:old',
                      kind: 'task',
                      object_id: 'old',
                      title: 'История прежнего состава',
                    },
                  ],
                  next_cursor: {
                    session: 'old',
                    at: '2026-10-20T10:00:00Z',
                    key: 'task:old',
                    badges: [],
                  },
                },
                error: null,
              }
          : { data: [], error: null },
    ),
  )
  mount(<StatisticsSection context="a:b" />)
  expect(
    await screen.findByText('История прежнего состава'),
  ).toBeInTheDocument()
  more = true
  fireEvent.click(screen.getByRole('button', { name: 'Ещё 20 событий' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Состав пары или история изменились',
  )
  expect(screen.queryByText('История прежнего состава')).not.toBeInTheDocument()
})
test('server membership epoch mismatch never renders stale titles under a new client key', async () => {
  mount(<StatisticsSection context="a:c" />)
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.queryByText('Наш совместный путь')).not.toBeInTheDocument()
})
