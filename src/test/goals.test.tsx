// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider } from '../features/auth/auth-provider'
import { ProtectedRoute } from '../features/auth/auth-screens'
import type { AppClient } from '../features/auth/auth-context'
import type { CoupleGoal, GoalConsent, GoalStep } from '../lib/database.types'
import type { GoalsWorkspace } from '../features/goals/api'
import {
  GoalsScreen,
  GoalDetailScreen,
  ConsentCard,
  GoalStepCard,
  DemoGoals,
} from '../features/goals/screens'
import { GoalForm, StepForm } from '../features/goals/forms'
import { clearGoalIntent } from '../features/goals/intents'
import { goalSchema } from '../features/goals/model'
const query = vi.hoisted(() => vi.fn())
vi.mock('../features/goals/api', async (original) => ({
  ...(await original<typeof import('../features/goals/api')>()),
  useGoals: () => query(),
}))
const session = {
  user: { id: 'a', email: 'a@example.test', email_confirmed_at: '2026-10-20' },
} as Session
const goal: CoupleGoal = {
  id: 'goal',
  request_id: 'key',
  space_id: 'space',
  creator_id: 'a',
  partner_id: 'b',
  title: 'Вместе в Карпаты',
  description: 'Наша маленькая мечта',
  category: 'travel',
  emoji: '🏔️',
  target_date: null,
  status: 'active',
  created_at: '2026-10-20T10:00:00Z',
  completed_at: null,
}
const step: GoalStep = {
  id: 'step',
  goal_id: 'goal',
  title: 'Выбрать даты',
  description: 'Обсудить удобное время',
  position: 1,
  status: 'active',
  created_at: '2026-10-20T10:00:00Z',
  completed_at: null,
}
const consent: GoalConsent = {
  id: 'consent',
  goal_id: 'goal',
  request_id: 'request',
  requester_id: 'b',
  kind: 'step_add',
  payload: { title: 'Найти жильё', assignment: 'partner' },
  status: 'pending',
  created_at: '2026-10-20T10:00:00Z',
  responded_at: null,
}
function data(): GoalsWorkspace {
  return {
    goals: [goal],
    consents: [],
    steps: [],
    participants: [],
    completions: [],
    events: [],
    progress: [
      { goal_id: 'goal', total_steps: 0, completed_steps: 0, percent: 0 },
    ],
    couple: {
      space: { id: 'space', created_at: '', archived_at: null },
      members: [
        {
          id: '1',
          user_id: 'a',
          space_id: 'space',
          seat: 1,
          joined_at: '',
          left_at: null,
        },
        {
          id: '2',
          user_id: 'b',
          space_id: 'space',
          seat: 2,
          joined_at: '',
          left_at: null,
        },
      ],
      profiles: [
        {
          id: 'b',
          display_name: 'Богдан',
          avatar_url: null,
          created_at: '',
          updated_at: '',
        },
      ],
      invitations: [],
    },
  }
}
function wrapper(children: React.ReactNode, path = '/goals', online = true) {
  const rpc = vi.fn().mockResolvedValue({ data: 'id', error: null })
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
    rpc,
  } as unknown as AppClient
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const rendered = render(
    <QueryClientProvider client={cache}>
      <AuthProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/goals" element={children} />
              <Route path="/goals/:goalId" element={children} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { ...rendered, rpc, cache }
}
beforeEach(() => {
  sessionStorage.clear()
  clearGoalIntent('a', 'create:space')
  clearGoalIntent('a', 'change:goal')
  query.mockReturnValue({
    isPending: false,
    isError: false,
    data: data(),
    refetch: vi.fn().mockResolvedValue({ data: data(), error: null }),
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
test('goal list uses server progress including empty 0% and links to detail', async () => {
  wrapper(<GoalsScreen />)
  expect(await screen.findByText('0%')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Открыть цель' })).toHaveAttribute(
    'href',
    '/goals/goal',
  )
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0')
})
test('filters show waiting, paused and completed goals without losing active data', async () => {
  const d = data()
  d.goals.push(
    { ...goal, id: 'pending', title: 'Новый дом', status: 'pending' },
    { ...goal, id: 'paused', title: 'Наши прогулки', status: 'paused' },
    { ...goal, id: 'done', title: 'Учить испанский', status: 'completed' },
  )
  query.mockReturnValue({ isPending: false, isError: false, data: d })
  wrapper(<GoalsScreen />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Предложения · 1' }),
  )
  expect(screen.getByText('Новый дом')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'На паузе' }))
  expect(screen.getByText('Наши прогулки')).toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Завершённые и закрытые' }),
  )
  expect(screen.getByText('Учить испанский')).toBeInTheDocument()
})
test('missing partner retains space and disables creating shared goals', async () => {
  const d = data()
  d.goals = []
  d.couple!.members = d.couple!.members.slice(0, 1)
  query.mockReturnValue({ isPending: false, isError: false, data: d })
  wrapper(<GoalsScreen />)
  expect(
    await screen.findByText('Мечтам нужен второй участник'),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Новая цель' })).toBeDisabled()
  expect(
    screen.getByRole('link', { name: 'Пригласить партнёра' }),
  ).toHaveAttribute('href', '/space/invite')
})
test('goal creation validates fields and retries same UUID without reward or partner IDs', async () => {
  const close = vi.fn()
  const w = wrapper(<GoalForm close={close} />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Предложить цель' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Введите хотя бы 2 символа',
  )
  expect(w.rpc).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Название цели'), {
    target: { value: 'Поехать вместе' },
  })
  w.rpc
    .mockResolvedValueOnce({
      data: null,
      error: { message: 'Failed to fetch' },
    })
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValueOnce({ data: 'goal', error: null })
  fireEvent.click(screen.getByRole('button', { name: 'Предложить цель' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Проверить прежний запрос' }),
    ).toBeEnabled(),
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Проверить прежний запрос' }),
  )
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Отправить исходный запрос повторно',
    }),
  )
  await waitFor(() => expect(close).toHaveBeenCalled())
  expect(w.rpc.mock.calls[0][1]).toEqual(w.rpc.mock.calls[2][1])
  expect(w.rpc.mock.calls[0][1]).not.toHaveProperty('p_partner_id')
  expect(w.rpc.mock.calls[0][1]).not.toHaveProperty('xp')
})
test('date validation rejects invalid calendar values without throwing', () => {
  for (const date of ['2026-99-99', '2026-02-30', '2300-01-01'])
    expect(
      goalSchema.safeParse({
        title: 'Цель',
        description: '',
        category: 'travel',
        emoji: '🏔️',
        target_date: date,
      }).success,
    ).toBe(false)
})
test('only counterpart can accept consent, author sees withdrawal', async () => {
  const w = wrapper(<ConsentCard consent={consent} data={data()} />)
  expect(await screen.findByText('Участвует: Вы')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Согласен(на)' }))
  await waitFor(() =>
    expect(w.rpc).toHaveBeenCalledWith('resolve_goal_consent', {
      p_consent_id: 'consent',
      p_decision: 'accept',
    }),
  )
  cleanup()
  wrapper(
    <ConsentCard consent={{ ...consent, requester_id: 'a' }} data={data()} />,
  )
  expect(
    await screen.findByRole('button', { name: 'Отозвать предложение' }),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Согласен(на)' }),
  ).not.toBeInTheDocument()
})
test('step form proposes assignment for agreement and never directly writes participants', async () => {
  const w = wrapper(<StepForm goal="goal" close={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('Название шага'), {
    target: { value: 'Выбрать даты' },
  })
  fireEvent.change(screen.getByLabelText('Кто участвует'), {
    target: { value: 'partner' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Предложить шаг' }))
  await waitFor(() =>
    expect(w.rpc).toHaveBeenCalledWith(
      'propose_goal_change',
      expect.objectContaining({
        p_goal_id: 'goal',
        p_kind: 'step_add',
        p_payload: {
          title: 'Выбрать даты',
          description: '',
          assignment: 'partner',
        },
      }),
    ),
  )
})
test('step self-completion sends only step ID and shared step waits for the other mark', async () => {
  const d = data()
  d.steps = [step]
  d.participants = [
    { step_id: 'step', user_id: 'a' },
    { step_id: 'step', user_id: 'b' },
  ]
  const w = wrapper(
    <GoalStepCard step={step} data={d} locked={false} edit={vi.fn()} />,
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Я выполнил(а) шаг' }),
  )
  await waitFor(() =>
    expect(w.rpc).toHaveBeenCalledWith('complete_goal_step', {
      p_step_id: 'step',
    }),
  )
  cleanup()
  d.completions = [{ step_id: 'step', user_id: 'a', completed_at: '' }]
  wrapper(<GoalStepCard step={step} data={d} locked={false} edit={vi.fn()} />)
  expect(await screen.findByText(/ждём партнёра/)).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Я выполнил(а) шаг' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Изменить по согласию' }),
  ).not.toBeInTheDocument()
})
test('unassigned partner cannot mark step for another participant', async () => {
  const d = data()
  d.participants = [{ step_id: 'step', user_id: 'b' }]
  const w = wrapper(
    <GoalStepCard step={step} data={d} locked={false} edit={vi.fn()} />,
  )
  expect(await screen.findByText(/Богдан/)).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Я выполнил(а) шаг' }),
  ).not.toBeInTheDocument()
  expect(w.rpc).not.toHaveBeenCalled()
})
test('empty goal cannot finish; paused and offline states disable changes', async () => {
  wrapper(<GoalDetailScreen />, '/goals/goal')
  expect(
    await screen.findByRole('button', { name: 'Предложить завершение' }),
  ).toBeDisabled()
  cleanup()
  const d = data()
  d.goals = [{ ...goal, status: 'paused' }]
  query.mockReturnValue({ isPending: false, isError: false, data: d })
  wrapper(<GoalDetailScreen />, '/goals/goal', false)
  expect(
    await screen.findByRole('button', { name: 'Предложить продолжить' }),
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Добавить шаг' })).toBeDisabled()
})
test('completed goal congratulates with existing server award and is read only', async () => {
  const d = data()
  d.goals = [
    { ...goal, status: 'completed', completed_at: '2026-10-20T10:00:00Z' },
  ]
  d.steps = [{ ...step, status: 'completed' }]
  d.progress = [
    { goal_id: 'goal', total_steps: 1, completed_steps: 1, percent: 100 },
  ]
  query.mockReturnValue({ isPending: false, isError: false, data: d })
  const w = wrapper(<GoalDetailScreen />, '/goals/goal')
  expect(await screen.findByText('Вы сделали это вместе!')).toBeInTheDocument()
  expect(
    screen.getByText(/50 Together XP уже добавлены сервером/),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Добавить шаг' }),
  ).not.toBeInTheDocument()
  expect(w.rpc).not.toHaveBeenCalled()
})
test('complete proposal waits for both and errors do not leak SQL or show a successful award', async () => {
  const d = data()
  d.consents = [{ ...consent, kind: 'complete', payload: {} }]
  query.mockReturnValue({ isPending: false, isError: false, data: d })
  const w = wrapper(<GoalDetailScreen />, '/goals/goal')
  w.rpc.mockResolvedValue({
    data: null,
    error: { message: 'SQLSTATE constraint private uuid' },
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Согласен(на)' }))
  expect(await screen.findByRole('alert')).not.toHaveTextContent('SQLSTATE')
  expect(screen.queryByText('Вы сделали это вместе!')).not.toBeInTheDocument()
})
test('detail cannot disclose unavailable UUIDs; loading and safe query errors have states', async () => {
  wrapper(<GoalDetailScreen />, '/goals/foreign')
  expect(await screen.findByText('Цель недоступна')).toBeInTheDocument()
  cleanup()
  query.mockReturnValue({ isPending: true })
  wrapper(<GoalsScreen />)
  expect(await screen.findByRole('status')).toHaveTextContent('Загружаем')
  cleanup()
  query.mockReturnValue({
    isPending: false,
    isError: true,
    error: { message: 'SQL private' },
    refetch: vi.fn(),
  })
  wrapper(<GoalsScreen />)
  expect(await screen.findByRole('alert')).not.toHaveTextContent('SQL')
})
test('demo explicitly disables proposals and never shows server completion', () => {
  render(<DemoGoals />)
  expect(screen.getByText(/Пример · деморежим/)).toBeInTheDocument()
  expect(screen.getByRole('button')).toBeDisabled()
  expect(screen.queryByText('Вы сделали это вместе!')).not.toBeInTheDocument()
})

test('review: unknown create outcome survives form remount without posting until explicit replay', async () => {
  const first = wrapper(<GoalForm close={vi.fn()} />)
  first.rpc.mockResolvedValue({
    data: null,
    error: { message: 'Failed to fetch' },
  })
  fireEvent.change(await screen.findByLabelText('Название цели'), {
    target: { value: 'Тихий отпуск' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Предложить цель' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Проверить прежний запрос' }),
    ).toBeEnabled(),
  )
  const args = first.rpc.mock.calls[0][1]
  cleanup()
  const d = data()
  d.goals.push({ ...goal, id: 'new-goal', status: 'closed' })
  query.mockReturnValue({ isPending: false, isError: false, data: d })
  const second = wrapper(<GoalForm close={vi.fn()} />)
  expect(
    await screen.findByRole('button', { name: 'Проверить прежний запрос' }),
  ).toBeEnabled()
  expect(second.rpc).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('Название цели')).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Проверить прежний запрос' }),
  )
  await waitFor(() =>
    expect(second.rpc).toHaveBeenCalledWith('inspect_goal_request', {
      p_request_id: args.p_request_id,
      p_goal_id: null,
    }),
  )
  expect(second.rpc).toHaveBeenCalledTimes(1)
})
test('review: reconnect never automatically posts unknown proposal; a fresh explicit discard is required for new conditions', async () => {
  const w = wrapper(<GoalForm close={vi.fn()} />)
  w.rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
  fireEvent.change(await screen.findByLabelText('Название цели'), {
    target: { value: 'Наше путешествие' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Предложить цель' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Проверить прежний запрос' }),
    ).toBeEnabled(),
  )
  const before = w.rpc.mock.calls.length
  window.dispatchEvent(new Event('offline'))
  window.dispatchEvent(new Event('online'))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Проверить прежний запрос' }),
    ).toBeEnabled(),
  )
  expect(w.rpc).toHaveBeenCalledTimes(before)
  expect(screen.queryByLabelText('Название цели')).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Проверил(а) историю — начать новое действие',
    }),
  )
  expect(await screen.findByLabelText('Название цели')).toBeInTheDocument()
  expect(w.rpc).toHaveBeenCalledTimes(before)
})
test('review: fresh duplicate goal and step require separate explicit confirmation after lost storage', async () => {
  const w = wrapper(<GoalForm close={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('Название цели'), {
    target: { value: goal.title },
  })
  fireEvent.change(screen.getByLabelText('Описание цели'), {
    target: { value: goal.description },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Предложить цель' }))
  expect(await screen.findByText(/Такая цель уже есть/)).toBeInTheDocument()
  expect(w.rpc).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Создать отдельную цель с такими условиями',
    }),
  )
  await waitFor(() => expect(w.rpc).toHaveBeenCalledTimes(1))
  cleanup()
  const d = data()
  d.steps = [{ ...step, description: '' }]
  d.participants = [
    { step_id: 'step', user_id: 'a' },
    { step_id: 'step', user_id: 'b' },
  ]
  query.mockReturnValue({ isPending: false, isError: false, data: d })
  const v = wrapper(<StepForm goal="goal" close={vi.fn()} />)
  fireEvent.change(await screen.findByLabelText('Название шага'), {
    target: { value: step.title },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Предложить шаг' }))
  expect(
    await screen.findByText(/Такой шаг уже согласован/),
  ).toBeInTheDocument()
  expect(v.rpc).not.toHaveBeenCalled()
})
test('review: offline submit is rejected rather than queued for automatic reconnect', async () => {
  const w = wrapper(<GoalForm close={vi.fn()} />, '/goals', false)
  fireEvent.change(await screen.findByLabelText('Название цели'), {
    target: { value: 'Без сети' },
  })
  fireEvent.submit(
    screen.getByRole('button', { name: 'Предложить цель' }).closest('form')!,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи')
  window.dispatchEvent(new Event('online'))
  await Promise.resolve()
  expect(w.rpc).not.toHaveBeenCalled()
})
test('review: missing request inspection is read only; original send needs another explicit click with the saved fence', async () => {
  const { goalIntent } = await import('../features/goals/intents')
  const intent = goalIntent(
    'a',
    {
      kind: 'create',
      space: 'space',
      values: {
        title: 'Исходная мечта',
        description: '',
        category: 'travel',
        emoji: '🏔️',
        target_date: '',
      },
    },
    0,
  )
  const w = wrapper(<GoalForm close={vi.fn()} />)
  w.rpc
    .mockResolvedValueOnce({ data: null, error: null })
    .mockResolvedValue({ data: 'goal', error: null })
  fireEvent.click(
    await screen.findByRole('button', { name: 'Проверить прежний запрос' }),
  )
  expect(
    await screen.findByRole('button', {
      name: 'Отправить исходный запрос повторно',
    }),
  ).toBeEnabled()
  expect(w.rpc).toHaveBeenCalledTimes(1)
  expect(w.rpc.mock.calls[0][0]).toBe('inspect_goal_request')
  window.dispatchEvent(new Event('online'))
  await Promise.resolve()
  expect(w.rpc).toHaveBeenCalledTimes(1)
  fireEvent.click(
    screen.getByRole('button', { name: 'Отправить исходный запрос повторно' }),
  )
  await waitFor(() =>
    expect(w.rpc).toHaveBeenCalledWith(
      'create_couple_goal',
      expect.objectContaining({
        p_request_id: intent.request,
        p_expected_goals: 0,
        p_title: 'Исходная мечта',
      }),
    ),
  )
})
test('review: completed goal can inspect a lost change response without proposing anything', async () => {
  const { goalIntent } = await import('../features/goals/intents')
  const intent = goalIntent(
    'a',
    { kind: 'propose', goal: 'goal', change: 'complete', payload: {} },
    3,
  )
  const d = data()
  d.goals = [{ ...goal, status: 'completed' }]
  query.mockReturnValue({ data: d, isPending: false, isError: false })
  const w = wrapper(<GoalDetailScreen />, '/goals/goal')
  w.rpc.mockResolvedValue({
    data: { id: 'consent', kind: 'complete', status: 'accepted' },
    error: null,
  })
  fireEvent.click(
    await screen.findByRole('button', { name: 'Проверить прежний запрос' }),
  )
  await waitFor(() => expect(w.rpc).toHaveBeenCalledTimes(1))
  expect(w.rpc).toHaveBeenCalledWith('inspect_goal_request', {
    p_request_id: intent.request,
    p_goal_id: 'goal',
  })
})
