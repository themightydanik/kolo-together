// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import {
  RitualCard,
  RitualsSection,
  TodayRituals,
  DemoRituals,
} from '../features/rituals/screens'
import { RitualForm } from '../features/rituals/forms'
import {
  ritualSchema,
  presets,
  defaultTerms,
  scheduleLabel,
  type RitualCardData,
  type RitualPage,
} from '../features/rituals/model'
import {
  clearRitualIntent,
  ritualIntent,
  readRitualIntent,
} from '../features/rituals/intents'
const auth = vi.hoisted(() => ({
  session: { user: { id: 'a' } },
  online: true,
  client: { rpc: vi.fn() },
}))
vi.mock('../features/auth/auth-context', () => ({ useAuth: () => auth }))
vi.mock('../features/couple/api', () => ({
  useCouple: () => ({
    isSuccess: true,
    data: { space: { id: 'space' }, members: [{ id: 'm1' }, { id: 'm2' }] },
  }),
}))
const terms = {
  ...defaultTerms,
  title: 'Совместный чай',
  description: 'Если хочется обоим',
  emoji: '☕' as const,
}
function ritual(): RitualCardData {
  return {
    id: 'ritual',
    space_id: 'space',
    creator_id: 'a',
    partner_id: 'b',
    request_id: 'request',
    terms,
    status: 'active',
    version: 1,
    starts_on: '2026-10-21',
    created_at: '2026-10-21T10:00:00Z',
    closed_at: null,
    pending: null,
    request_version: 1,
    instance: {
      id: 'instance',
      space_id: 'space',
      ritual_id: 'ritual',
      period_key: 'd:2026-10-21',
      scheduled_on: '2026-10-21',
      version: 1,
      terms,
      status: 'waiting',
      reason: null,
      created_at: '2026-10-21T10:00:00Z',
      completed_at: null,
      marks: [],
    },
  }
}
function page(): RitualPage {
  return {
    rituals: [ritual()],
    next_cursor: null,
    context: 'm1:m2',
    today: '2026-10-21',
    space_id: 'space',
    partner_connected: true,
    create_version: 0,
  }
}
function mount(children: React.ReactNode) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const result = render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...result, cache }
}
beforeEach(() => {
  auth.online = true
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  sessionStorage.clear()
  clearRitualIntent('a', 'create:space')
  clearRitualIntent('a', 'change:ritual')
  auth.client.rpc.mockReset()
  auth.client.rpc.mockImplementation((fn: string) =>
    Promise.resolve({
      error: null,
      data:
        fn === 'list_couple_rituals'
          ? page()
          : fn === 'refresh_ritual_instances'
            ? '2026-10-21'
            : fn === 'get_ritual_summary'
              ? {
                  context: 'm1:m2',
                  timezone: 'UTC',
                  completed: 0,
                  calendar: Array.from({ length: 30 }, (_, i) => ({
                    day: `2026-10-${String(i + 1).padStart(2, '0')}`,
                    completed: 0,
                  })),
                }
              : fn === 'list_ritual_history'
                ? { context: 'm1:m2', items: [], next_cursor: null }
                : null,
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
test('nine optional presets, UTC schedule validation and physical contact always requires fresh willingness', async () => {
  expect(presets).toHaveLength(9)
  expect(
    ritualSchema.safeParse({ ...terms, cadence: 'weekly', days: [1, 2] })
      .success,
  ).toBe(false)
  expect(
    ritualSchema.safeParse({ ...terms, cadence: 'weekdays', days: [] }).success,
  ).toBe(false)
  expect(scheduleLabel({ ...terms, cadence: 'weekly', days: [7] })).toContain(
    'Вс',
  )
  mount(
    <RitualForm
      space="space"
      expected={0}
      refresh={async () => {}}
      close={() => {}}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: '🤗 Объятия' }))
  expect(
    (screen.getByLabelText('Описание') as HTMLTextAreaElement).value,
  ).toContain('не означает согласия')
  expect(auth.client.rpc).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Расписание'), {
    target: { value: 'weekly' },
  })
  fireEvent.click(screen.getByLabelText('Ср'))
  fireEvent.click(screen.getByRole('button', { name: 'Отправить предложение' }))
  await waitFor(() =>
    expect(auth.client.rpc).toHaveBeenCalledWith(
      'create_couple_ritual',
      expect.objectContaining({
        p_terms: expect.objectContaining({ cadence: 'weekly', days: [3] }),
        p_expected_creations: 0,
      }),
    ),
  )
  const args = auth.client.rpc.mock.calls.find(
    (c) => c[0] === 'create_couple_ritual',
  )![1]
  expect(args).not.toHaveProperty('user_id')
  expect(args).not.toHaveProperty('xp')
})
test('recipient accepts or declines; author may only withdraw pending proposal', async () => {
  const r = ritual()
  r.status = 'pending'
  r.instance = null
  r.pending = {
    id: 'consent',
    ritual_id: r.id,
    requester_id: 'b',
    request_id: 'req',
    kind: 'activate',
    terms,
    status: 'pending',
    created_at: r.created_at,
    responded_at: null,
  }
  mount(<RitualCard ritual={r} refresh={async () => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }))
  await waitFor(() =>
    expect(auth.client.rpc).toHaveBeenCalledWith('resolve_ritual_consent', {
      p_consent_id: 'consent',
      p_decision: 'decline',
    }),
  )
  cleanup()
  r.pending.requester_id = 'a'
  mount(<RitualCard ritual={r} refresh={async () => {}} />)
  expect(
    screen.queryByRole('button', { name: 'Принять' }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Отозвать предложение' }),
  ).toBeInTheDocument()
})
test('each person marks only self, waiting second and completed cards never send a second participant UUID', async () => {
  const r = ritual()
  mount(<RitualCard ritual={r} refresh={async () => {}} today />)
  fireEvent.click(screen.getByRole('button', { name: 'Отметить своё участие' }))
  await waitFor(() =>
    expect(auth.client.rpc).toHaveBeenCalledWith('complete_ritual_instance', {
      p_instance_id: 'instance',
    }),
  )
  cleanup()
  r.instance!.marks = ['a']
  r.instance!.status = 'partial'
  mount(<RitualCard ritual={r} refresh={async () => {}} today />)
  expect(screen.getByText(/Ждём второго участника/)).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Отметить своё участие' }),
  ).not.toBeInTheDocument()
  cleanup()
  r.instance!.status = 'completed'
  r.instance!.marks = ['a', 'b']
  mount(<RitualCard ritual={r} refresh={async () => {}} today />)
  expect(screen.getByText(/Выполнено вместе/)).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
test('missed days are neutral and voluntary withdrawal is an explicit independent confirmation', async () => {
  const r = ritual()
  r.instance!.status = 'missed'
  mount(<RitualCard ritual={r} refresh={async () => {}} />)
  expect(screen.getByText(/Ничего страшного/)).toBeInTheDocument()
  expect(screen.queryByText(/неудача|провал/i)).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Отказаться от дальнейшего участия' }),
  )
  expect(auth.client.rpc).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Подтвердить отказ от участия' }),
  )
  await waitFor(() =>
    expect(auth.client.rpc).toHaveBeenCalledWith('withdraw_couple_ritual', {
      p_ritual_id: 'ritual',
    }),
  )
})
test('pending changes freeze participation and edit/pause/resume/close are proposals', async () => {
  const r = ritual()
  mount(<RitualCard ritual={r} refresh={async () => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Предложить паузу' }))
  await waitFor(() =>
    expect(auth.client.rpc).toHaveBeenCalledWith(
      'propose_ritual_change',
      expect.objectContaining({
        p_kind: 'pause',
        p_terms: {},
        p_expected_changes: 1,
      }),
    ),
  )
  cleanup()
  clearRitualIntent('a', 'change:ritual')
  r.pending = {
    id: 'c',
    ritual_id: r.id,
    requester_id: 'b',
    request_id: 'key',
    kind: 'edit',
    terms: { ...terms, title: 'Новое название' },
    status: 'pending',
    created_at: r.created_at,
    responded_at: null,
  }
  mount(<RitualCard ritual={r} refresh={async () => {}} />)
  expect(
    screen.getByRole('region', { name: 'Согласование ритуала' }),
  ).toHaveTextContent('Новое название')
  expect(
    screen.queryByRole('button', { name: 'Отметить своё участие' }),
  ).not.toBeInTheDocument()
})
test('unknown create response retains UUID/payload/fence across reload and lookup is read-only before explicit retry', async () => {
  auth.client.rpc.mockImplementation((fn: string) =>
    Promise.resolve(
      fn === 'create_couple_ritual'
        ? { data: null, error: { message: 'Failed to fetch' } }
        : { data: null, error: null },
    ),
  )
  const view = mount(
    <RitualForm
      space="space"
      expected={0}
      refresh={async () => {}}
      close={() => {}}
    />,
  )
  fireEvent.change(screen.getByLabelText('Название'), {
    target: { value: 'Наш чай' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Отправить предложение' }))
  expect(
    await screen.findByRole('button', { name: 'Проверить прежний запрос' }),
  ).toBeInTheDocument()
  const initial = auth.client.rpc.mock.calls.find(
    (c) => c[0] === 'create_couple_ritual',
  )![1]
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Проверить прежний запрос' }),
    ).toBeEnabled(),
  )
  view.unmount()
  mount(
    <RitualForm
      space="space"
      expected={9}
      refresh={async () => {}}
      close={() => {}}
    />,
  )
  expect(
    auth.client.rpc.mock.calls.filter((c) => c[0] === 'create_couple_ritual'),
  ).toHaveLength(1)
  fireEvent.click(
    screen.getByRole('button', { name: 'Проверить прежний запрос' }),
  )
  expect(
    await screen.findByRole('button', { name: 'Повторить исходный запрос' }),
  ).toBeInTheDocument()
  expect(auth.client.rpc).toHaveBeenCalledWith('inspect_ritual_request', {
    p_request_id: initial.p_request_id,
    p_ritual_id: null,
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Повторить исходный запрос' }),
  )
  await waitFor(() =>
    expect(
      auth.client.rpc.mock.calls.filter((c) => c[0] === 'create_couple_ritual'),
    ).toHaveLength(2),
  )
  expect(
    auth.client.rpc.mock.calls.filter(
      (c) => c[0] === 'create_couple_ritual',
    )[1][1],
  ).toEqual(initial)
})
test('disabled sessionStorage keeps original intention in memory and never silently rebases changed conditions', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw Error('disabled')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw Error('disabled')
  })
  const first = ritualIntent(
    'a',
    { kind: 'create', space: 'space', values: terms },
    0,
  )
  expect(
    ritualIntent('a', { kind: 'create', space: 'space', values: terms }, 20),
  ).toEqual(first)
  expect(() =>
    ritualIntent(
      'a',
      {
        kind: 'create',
        space: 'space',
        values: { ...terms, title: 'Иные условия' },
      },
      20,
    ),
  ).toThrow('ritual_intent_pending')
  expect(readRitualIntent('other', 'create:space')).toBeNull()
})
test('offline actions are disabled and reconnect does not queue a proposal or mark', async () => {
  auth.online = false
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  mount(<RitualCard ritual={ritual()} refresh={async () => {}} />)
  expect(
    screen.getByRole('button', { name: 'Отметить своё участие' }),
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Предложить паузу' }))
  expect(auth.client.rpc).not.toHaveBeenCalled()
  auth.online = true
  window.dispatchEvent(new Event('online'))
  expect(auth.client.rpc).not.toHaveBeenCalled()
})
test('Today block uses the server period, no sixth tab, and solo waiting has no fake confirmations', async () => {
  mount(<TodayRituals />)
  expect(
    await screen.findByRole('region', { name: 'Наши ритуалы' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Управлять' })).toHaveAttribute(
    'href',
    '/us/traditions',
  )
  expect(auth.client.rpc).toHaveBeenCalledWith('list_couple_rituals', {
    p_filter: 'today',
    p_cursor: null,
    p_limit: 50,
  })
  cleanup()
  const empty = { ...page(), rituals: [], partner_connected: false }
  auth.client.rpc.mockImplementation((fn: string) =>
    Promise.resolve({
      error: null,
      data: fn === 'list_couple_rituals' ? empty : '2026-10-21',
    }),
  )
  mount(<TodayRituals />)
  expect(
    await screen.findByText('Ритуалы ждут подключения партнёра'),
  ).toBeInTheDocument()
})
test('management has four filters, thirty UTC calendar days and genuine server history pagination', async () => {
  const cursor = {
    actor: 'a',
    context: 'm1:m2',
    day: '2026-10-20',
    id: 'old',
    until: '2026-10-21T10:00:00Z',
  }
  auth.client.rpc.mockImplementation(
    (fn: string, args?: { p_cursor: unknown }) =>
      Promise.resolve({
        error: null,
        data:
          fn === 'list_couple_rituals'
            ? page()
            : fn === 'get_ritual_summary'
              ? {
                  context: 'm1:m2',
                  timezone: 'UTC',
                  completed: 1,
                  calendar: Array.from({ length: 30 }, (_, i) => ({
                    day: `2026-10-${String(i + 1).padStart(2, '0')}`,
                    completed: 0,
                  })),
                }
              : fn === 'list_ritual_history'
                ? {
                    context: 'm1:m2',
                    items: [
                      {
                        ...ritual().instance!,
                        id: args?.p_cursor ? 'older' : 'old',
                        status: 'completed',
                        marks: 2,
                      },
                    ],
                    next_cursor: args?.p_cursor ? null : cursor,
                  }
                : '2026-10-21',
      }),
  )
  mount(<RitualsSection />)
  expect(
    await screen.findByRole('list', { name: 'Календарь ритуалов UTC' }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('list', { name: 'Календарь ритуалов UTC' }).children,
  ).toHaveLength(30)
  expect(
    within(
      screen.getByRole('group', { name: 'Фильтры ритуалов' }),
    ).getAllByRole('button'),
  ).toHaveLength(4)
  fireEvent.click(screen.getByRole('button', { name: 'Ещё 20 дней' }))
  await waitFor(() =>
    expect(auth.client.rpc).toHaveBeenCalledWith('list_ritual_history', {
      p_cursor: cursor,
      p_limit: 20,
    }),
  )
})
test('raw SQL errors and a mismatched membership epoch never display protected ritual details', async () => {
  const p = { ...page(), context: 'm1:new' }
  auth.client.rpc.mockImplementation((fn: string) =>
    Promise.resolve({
      error: null,
      data: fn === 'list_couple_rituals' ? p : '2026-10-21',
    }),
  )
  mount(<TodayRituals />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Состав пары изменился',
  )
  expect(screen.queryByText('☕ Совместный чай')).not.toBeInTheDocument()
  cleanup()
  auth.client.rpc.mockResolvedValue({
    data: null,
    error: { message: 'SQLSTATE internal_private_id' },
  })
  mount(<TodayRituals />)
  expect(await screen.findByRole('alert')).not.toHaveTextContent('SQLSTATE')
})
test('demo is a labelled read-only example, not a server fact', () => {
  mount(<DemoRituals />)
  expect(screen.getByText(/Демонстрационный пример/)).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(auth.client.rpc).not.toHaveBeenCalled()
})
