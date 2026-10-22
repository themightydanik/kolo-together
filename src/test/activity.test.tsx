// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ActivityScreen,
  ActivityBell,
  ActivityCard,
  TodayActivity,
} from '../features/activity/screens'
import {
  activityDay,
  activityError,
  type ActivityItem,
} from '../features/activity/model'
const state = vi.hoisted(() => ({
  client: {} as object | null,
  online: true,
  pages: {
    isPending: false,
    isError: false,
    error: null as unknown,
    data: { pages: [{ items: [] as ActivityItem[] }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  },
  summary: {
    isError: false,
    data: {
      unread: 0,
      reactions_enabled: true,
      spotlight: null as ActivityItem | null,
    },
    refetch: vi.fn(),
  },
  write: { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() },
  couple: { isError: false, isPending: false, refetch: vi.fn() },
}))
vi.mock('../features/auth/auth-context', () => ({
  useAuth: () => ({
    client: state.client,
    online: state.online,
    session: { user: { id: 'me' } },
  }),
}))
vi.mock('../features/activity/api', () => ({
  useActivityContext: () => ({
    enabled: state.online,
    context: 'epoch',
    online: state.online,
    couple: state.couple,
  }),
  useActivityPages: () => state.pages,
  useActivitySummary: () => state.summary,
  useActivityWrite: () => state.write,
}))
const item = (extra: Partial<ActivityItem> = {}): ActivityItem => ({
  id: 'event',
  kind: 'task_done',
  source_id: 'instance',
  slot: 0,
  created_at: '2026-10-22T12:00:00Z',
  read_at: null,
  can_react: true,
  own_reaction: null,
  ...extra,
})
function view(ui: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <MemoryRouter>
        <Routes>
          <Route path="/" element={ui} />
          <Route path="/tasks" element={<p>Мої справи</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  state.client = {}
  state.online = true
  state.couple.isError = false
  state.couple.isPending = false
  state.pages.isPending = false
  state.pages.isError = false
  state.pages.error = null
  state.pages.data = { pages: [{ items: [] }] }
  state.summary.data = { unread: 0, reactions_enabled: true, spotlight: null }
  state.summary.isError = false
  state.write.isPending = false
  vi.clearAllMocks()
  state.write.mutateAsync.mockResolvedValue({ path: '/tasks' })
  sessionStorage.clear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
test('demo is explicitly readonly, five-section navigation remains external and no fake event is delivered', () => {
  state.client = null
  view(
    <>
      <ActivityBell />
      <ActivityScreen />
      <TodayActivity />
    </>,
  )
  expect(screen.getByText(/У демо ми не надсилаємо/)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Прочитати всі' })).toBeNull()
  expect(state.write.mutate).not.toHaveBeenCalled()
  expect(screen.getByRole('link', { name: 'Події пари' })).toHaveAttribute(
    'href',
    '/activity',
  )
})
test('bell caps unread count and suppresses badge after server error/offline', () => {
  state.summary.data.unread = 100
  const v = view(<ActivityBell />)
  expect(
    screen.getByRole('link', { name: 'Події пари: 99+ непрочитаних' }),
  ).toBeVisible()
  state.summary.isError = true
  v.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ActivityBell />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(screen.getByRole('link', { name: 'Події пари' })).toBeVisible()
})
test('loading, empty, sanitized SQL errors and retry never display stale shared events', () => {
  state.pages.isPending = true
  const v = view(<ActivityScreen />)
  expect(screen.getByRole('status')).toHaveTextContent('Збираємо')
  v.unmount()
  state.pages.isPending = false
  state.pages.isError = true
  state.pages.error = { message: 'SQL internal secret uuid' }
  state.pages.data = { pages: [{ items: [item()] }] }
  view(<ActivityScreen />)
  expect(screen.getByRole('alert')).not.toHaveTextContent('SQL')
  expect(screen.queryByText('Ви разом завершили справу')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Оновити події' }))
  expect(state.couple.refetch).toHaveBeenCalled()
})
test('offline hides cached metadata and reconnect is read-only, not a mutation queue', () => {
  state.online = false
  state.pages.data = { pages: [{ items: [item()] }] }
  const v = view(<ActivityScreen />)
  expect(screen.getByRole('status')).toHaveTextContent('немає зв’язку')
  expect(screen.queryByText('Ви разом завершили справу')).toBeNull()
  v.unmount()
  state.online = true
  view(<ActivityScreen />)
  expect(screen.getByText('Ви разом завершили справу')).toBeVisible()
  expect(state.write.mutateAsync).not.toHaveBeenCalled()
  expect(state.write.mutate).not.toHaveBeenCalled()
})
test('open waits for authorized server read, while read-only action does not navigate', async () => {
  view(<ActivityCard item={item()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Прочитано' }))
  await waitFor(() =>
    expect(state.write.mutateAsync).toHaveBeenCalledWith({
      kind: 'read',
      id: 'event',
    }),
  )
  expect(screen.queryByText('Мої справи')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Переглянути результат' }))
  expect(await screen.findByText('Мої справи')).toBeVisible()
})
test('revoked event cannot navigate on stale source link; internal errors stay private', async () => {
  state.write.mutateAsync.mockRejectedValue({
    message: 'SQL constraint auth.users',
  })
  view(<ActivityCard item={item()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Переглянути результат' }))
  expect(await screen.findByRole('alert')).not.toHaveTextContent('SQL')
  expect(screen.queryByText('Мої справи')).toBeNull()
})
test('mark-all is an explicit action with server-only recipient scope', () => {
  state.pages.data = { pages: [{ items: [item(), item({ id: 'second' })] }] }
  view(<ActivityScreen />)
  expect(state.write.mutate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Прочитати всі' }))
  expect(state.write.mutate).toHaveBeenCalledWith(
    { kind: 'read', id: null },
    expect.any(Object),
  )
})
test('one reaction, change or remove sends only stable state intention, never a client recipient or amount', async () => {
  view(<ActivityCard item={item({ own_reaction: 'support' })} />)
  fireEvent.click(screen.getByRole('button', { name: 'Підтримую' }))
  await waitFor(() => expect(state.write.mutateAsync).toHaveBeenCalled())
  const request = state.write.mutateAsync.mock.calls[0][0]
  expect(request).toEqual({
    kind: 'reaction',
    intent: {
      event: 'event',
      kind: null,
      expected: 'support',
      request: expect.any(String),
    },
  })
  expect(request.intent.request).toMatch(/^[a-f0-9-]{36}$/)
})
test('unknown reaction result retains original UUID/payload even with disabled storage; retry is explicit', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw Error('unavailable')
  })
  state.write.mutateAsync.mockRejectedValue(Error('timeout'))
  view(<ActivityCard item={item()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Пишаюся' }))
  expect(
    await screen.findByRole('button', { name: 'Повторити той самий вибір' }),
  ).toBeVisible()
  const first = state.write.mutateAsync.mock.calls[0][0]
  fireEvent.click(screen.getByRole('button', { name: 'Перевірити події' }))
  expect(state.write.mutateAsync).toHaveBeenCalledTimes(1)
  fireEvent.click(
    screen.getByRole('button', { name: 'Повторити той самий вибір' }),
  )
  await waitFor(() => expect(state.write.mutateAsync).toHaveBeenCalledTimes(2))
  expect(state.write.mutateAsync.mock.calls[1][0]).toEqual(first)
})
test('reload restores unknown reaction without automatically sending or rebasing it', () => {
  const intent = {
    event: 'event',
    kind: 'sweet',
    expected: null,
    request: 'stable-uuid',
  }
  sessionStorage.setItem('kolo:activity:me:epoch:event', JSON.stringify(intent))
  view(<ActivityCard item={item({ own_reaction: 'proud' })} />)
  expect(state.write.mutateAsync).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Це мило' })).toBeDisabled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Повторити той самий вибір' }),
  )
  expect(state.write.mutateAsync).toHaveBeenCalledWith({
    kind: 'reaction',
    intent,
  })
})
test('reaction notifications never offer reaction-on-reaction controls', () => {
  view(
    <ActivityCard
      item={item({ kind: 'reaction', reaction: 'thanks', can_react: false })}
    />,
  )
  expect(
    screen.queryByRole('group', { name: 'Підтримати партнера' }),
  ).toBeNull()
  expect(screen.getByText('Дякую')).toBeVisible()
})
test('Today stays empty without a useful event and renders just one bounded context', () => {
  const v = view(<TodayActivity />)
  expect(screen.queryByRole('complementary')).toBeNull()
  v.unmount()
  state.summary.data.spotlight = item()
  view(<TodayActivity />)
  expect(screen.getAllByRole('complementary')).toHaveLength(1)
  expect(
    screen.getByRole('link', { name: /Переглянути подію/ }),
  ).toHaveAttribute('href', '/activity')
})
test('human dates and known errors do not expose SQL details', () => {
  const now = new Date(2026, 9, 22, 12)
  expect(activityDay(new Date(2026, 9, 22).toISOString(), now)).toBe('Сьогодні')
  expect(activityDay(new Date(2026, 9, 21).toISOString(), now)).toBe('Учора')
  expect(activityDay(new Date(2026, 9, 19).toISOString(), now)).toBe('Раніше')
  expect(activityError({ message: 'activity_changed' })).toContain(
    'іншому вікні',
  )
  expect(activityError({ message: 'SQL uuid secret' })).not.toContain('SQL')
})
test('blocked storage retains the original reaction across an offline/refetch component remount in the same authenticated cache', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw Error('blocked')
  })
  state.write.mutateAsync.mockRejectedValue(Error('timeout'))
  const cache = new QueryClient(),
    tree = (show: boolean) => (
      <QueryClientProvider client={cache}>
        <MemoryRouter>
          {show ? <ActivityCard item={item()} /> : <p>Офлайн</p>}
        </MemoryRouter>
      </QueryClientProvider>
    )
  const rendered = render(tree(true))
  fireEvent.click(screen.getByRole('button', { name: 'Пишаюся' }))
  await screen.findByRole('button', { name: 'Повторити той самий вибір' })
  const original = state.write.mutateAsync.mock.calls[0][0]
  rendered.rerender(tree(false))
  rendered.rerender(tree(true))
  expect(state.write.mutateAsync).toHaveBeenCalledTimes(1)
  fireEvent.click(
    screen.getByRole('button', { name: 'Повторити той самий вибір' }),
  )
  await waitFor(() => expect(state.write.mutateAsync).toHaveBeenCalledTimes(2))
  expect(state.write.mutateAsync.mock.calls[1][0]).toEqual(original)
})
