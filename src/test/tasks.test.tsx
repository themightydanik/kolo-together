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
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider } from '../features/auth/auth-provider'
import { ProtectedRoute } from '../features/auth/auth-screens'
import type { AppClient } from '../features/auth/auth-context'
import type { Task, TaskInstance } from '../lib/database.types'
import { TaskForm } from '../features/tasks/form'
import { TaskCard, TasksScreen, TodayScreen } from '../features/tasks/screens'
import {
  collectRows,
  weekStart,
  type TaskWorkspace,
} from '../features/tasks/api'
const workspaceQuery = vi.hoisted(() => vi.fn())
vi.mock('../features/tasks/api', async (original) => ({
  ...(await original<typeof import('../features/tasks/api')>()),
  useTaskWorkspace: () => workspaceQuery(),
}))
const session = {
  user: {
    id: 'a',
    email: 'anna@example.test',
    email_confirmed_at: '2026-10-19',
  },
} as Session
const task: Task = {
  id: 'task',
  request_id: 'request',
  space_id: 'space',
  creator_id: 'a',
  title: 'Полить цветы',
  description: 'Вместе заботиться о доме',
  kind: 'personal',
  category: 'home',
  difficulty: 'easy',
  due_date: null,
  anchor_date: '2026-10-19',
  recurrence: 'once',
  status: 'active',
  created_at: '2026-10-19T10:00:00Z',
}
const instance: TaskInstance = {
  id: 'instance',
  task_id: 'task',
  period_start: '2026-10-19',
  status: 'active',
  xp: 10,
  coins: 5,
  together_xp: 0,
  created_at: '2026-10-19T10:00:00Z',
  completed_at: null,
}
function data(): TaskWorkspace {
  return {
    today: '2026-10-19',
    tasks: [task],
    instances: [instance],
    participants: [
      {
        task_id: 'task',
        user_id: 'a',
        consent: 'accepted',
        responded_at: '2026-10-19',
      },
    ],
    completions: [],
    xp: 40,
    coins: 20,
    togetherXp: 20,
    spaceId: 'space',
    hasPartner: true,
    ledger: [],
    rules: [
      { difficulty: 'easy', xp: 10, coins: 5 },
      { difficulty: 'normal', xp: 20, coins: 10 },
      { difficulty: 'hard', xp: 35, coins: 15 },
    ],
    settings: { id: true, together_xp: 20 },
    profile: {
      id: 'a',
      display_name: 'Анна',
      avatar_url: null,
      created_at: '2026-10-19',
      updated_at: '2026-10-19',
    },
  }
}
function wrapper(children: React.ReactNode) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
    rpc,
  } as unknown as AppClient
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={cache}>
      <AuthProvider client={client}>
        <MemoryRouter>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={children} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { rpc, cache }
}
beforeEach(() =>
  workspaceQuery.mockReturnValue({
    isPending: false,
    isError: false,
    data: data(),
  }),
)
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
test('task form validates fields and keeps partner actions unavailable without a partner', async () => {
  const solo = { ...data(), hasPartner: false }
  const close = vi.fn()
  const { rpc } = wrapper(<TaskForm data={solo} close={close} />)
  const submit = await screen.findByRole('button', { name: 'Создать дело' })
  fireEvent.click(submit)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Минимум 2 символа',
  )
  expect(screen.getByRole('option', { name: 'Совместное' })).toBeDisabled()
  expect(
    screen.getByRole('option', { name: 'Предложение партнёру' }),
  ).toBeDisabled()
  expect(rpc).not.toHaveBeenCalled()
})
test('create RPC contains no reward/user parameters and reuses its idempotency key on retry', async () => {
  const close = vi.fn()
  const { rpc } = wrapper(<TaskForm data={data()} close={close} />)
  rpc
    .mockResolvedValueOnce({ data: null, error: { message: 'network failed' } })
    .mockResolvedValueOnce({ data: 'task', error: null })
  fireEvent.change(await screen.findByLabelText('Название'), {
    target: { value: 'Прогуляться вместе' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Создать дело' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи')
  fireEvent.click(screen.getByRole('button', { name: 'Создать дело' }))
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  expect(rpc).toHaveBeenCalledTimes(2)
  const first = rpc.mock.calls[0][1],
    second = rpc.mock.calls[1][1]
  expect(first.p_request_id).toBe(second.p_request_id)
  expect(first).toMatchObject({
    p_title: 'Прогуляться вместе',
    p_kind: 'personal',
    p_difficulty: 'normal',
  })
  expect(Object.keys(first).sort()).toEqual(
    [
      'p_request_id',
      'p_title',
      'p_description',
      'p_kind',
      'p_category',
      'p_difficulty',
      'p_due_date',
      'p_recurrence',
    ].sort(),
  )
})
test.each([true, false])(
  'pending partner proposal requires own consent (%s)',
  async (accept) => {
    const incoming = {
      ...task,
      kind: 'proposal' as const,
      status: 'pending' as const,
      creator_id: 'b',
    }
    const feed = {
      ...data(),
      tasks: [incoming],
      instances: [],
      participants: [
        {
          task_id: 'task',
          user_id: 'a',
          consent: 'pending' as const,
          responded_at: null,
        },
      ],
    }
    const { rpc } = wrapper(<TaskCard task={incoming} data={feed} />)
    fireEvent.click(
      await screen.findByRole('button', {
        name: accept ? 'Принять' : 'Отклонить',
      }),
    )
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('respond_task', {
        p_task_id: 'task',
        p_accept: accept,
      }),
    )
    expect(
      screen.queryByRole('button', { name: 'Отметить своё выполнение' }),
    ).not.toBeInTheDocument()
  },
)
test('no successful reward is displayed until the server acknowledges completion', async () => {
  const { rpc } = wrapper(<TaskCard task={task} data={data()} />)
  let finish: (value: unknown) => void = () => {}
  rpc.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Отметить своё выполнение' }),
  )
  expect(screen.queryByText(/Сервер подтвердил/)).not.toBeInTheDocument()
  expect(
    await screen.findByRole('button', { name: 'Проверяем…' }),
  ).toBeDisabled()
  finish({
    data: { already_completed: false, xp: 10, coins: 5, together_xp: 0 },
    error: null,
  })
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Сервер подтвердил: +10 XP, +5 Coins',
  )
})
test('joint card shows 1/2 and never offers to complete the other participant or cancel a partial instance', async () => {
  const joint = { ...task, kind: 'joint' as const }
  const feed = {
    ...data(),
    tasks: [joint],
    instances: [{ ...instance, together_xp: 20 }],
    participants: [
      ...data().participants,
      {
        task_id: 'task',
        user_id: 'b',
        consent: 'accepted' as const,
        responded_at: '2026-10-19',
      },
    ],
    completions: [
      {
        id: 'done',
        instance_id: 'instance',
        user_id: 'a',
        completed_at: '2026-10-19',
      },
    ],
  }
  wrapper(<TaskCard task={joint} data={feed} />)
  expect(
    await screen.findByLabelText('Совместный прогресс 1 из 2'),
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Отметить своё выполнение' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Отменить дело' }),
  ).not.toBeInTheDocument()
})
test('task filters distinguish private, outgoing proposal, joint and completed instances', async () => {
  const feed = data()
  feed.tasks = [
    task,
    {
      ...task,
      id: 'outgoing',
      kind: 'proposal',
      title: 'Приготовить чай',
      status: 'pending',
    },
    {
      ...task,
      id: 'joint',
      kind: 'joint',
      title: 'Общая прогулка',
      status: 'pending',
    },
    { ...task, id: 'done', title: 'Сделано вчера', status: 'completed' },
  ]
  feed.instances.push({
    ...instance,
    id: 'done-instance',
    task_id: 'done',
    status: 'completed',
    completed_at: '2026-10-19',
  })
  workspaceQuery.mockReturnValue({
    isPending: false,
    isError: false,
    data: feed,
  })
  wrapper(<TasksScreen />)
  expect(await screen.findByText('Полить цветы')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Партнёру' }))
  expect(screen.getByText('Приготовить чай')).toBeVisible()
  expect(screen.queryByText('Полить цветы')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Совместные' }))
  expect(screen.getByText('Общая прогулка')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Выполненные' }))
  expect(screen.getByText('Сделано вчера')).toBeVisible()
})
test('today shows server progress and a safe SQL failure state', async () => {
  wrapper(<TodayScreen />)
  expect(await screen.findByText('Рады видеть вас, Анна')).toBeVisible()
  expect(screen.getByLabelText('Игровой прогресс')).toHaveTextContent('40')
  cleanup()
  workspaceQuery.mockReturnValue({
    isPending: false,
    isError: true,
    error: { message: 'SQLSTATE 23505 private user_id details' },
    refetch: vi.fn(),
  })
  wrapper(<TodayScreen />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Не удалось выполнить действие',
  )
  expect(screen.queryByText(/SQLSTATE/)).not.toBeInTheDocument()
})
test('calendar week uses Monday UTC including a year boundary and pagination never silently drops rows', async () => {
  expect(weekStart('2026-01-01')).toBe('2025-12-29')
  expect(weekStart('2026-10-25')).toBe('2026-10-19')
  const page = vi.fn(async (from: number, to: number) => ({
    data: Array.from({ length: from === 0 ? 200 : 3 }, (_, i) => from + i),
    error: null,
    to,
  }))
  expect(await collectRows(page)).toHaveLength(203)
  expect(page).toHaveBeenLastCalledWith(200, 399)
  await expect(
    collectRows(async () => ({
      data: null,
      error: new Error('network failed'),
    })),
  ).rejects.toThrow('network failed')
})

test('offline task actions are disabled without optimistic rewards', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const { rpc } = wrapper(<TaskCard task={task} data={data()} />)
  const button = await screen.findByRole('button', {
    name: 'Отметить своё выполнение',
  })
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(rpc).not.toHaveBeenCalled()
  expect(screen.queryByText(/Сервер подтвердил/)).not.toBeInTheDocument()
})
