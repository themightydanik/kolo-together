// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import type { Session } from '@supabase/supabase-js'
import { ProtectedRoute } from '../features/auth/auth-screens'
import { AuthProvider } from '../features/auth/auth-provider'
import type { AppClient } from '../features/auth/auth-context'
import {
  RewardsScreen,
  RewardOfferCard,
  PurchaseCard,
  DemoRewardStore,
} from '../features/rewards/screens'
import { RewardForm } from '../features/rewards/form'
import type { RewardStore } from '../features/rewards/api'
import type { RewardOffer, RewardPurchase } from '../lib/database.types'
import {
  purchaseRequest,
  clearPurchaseRequest,
} from '../features/rewards/purchase-request'
const query = vi.hoisted(() => vi.fn())
vi.mock('../features/rewards/api', async (original) => ({
  ...(await original<typeof import('../features/rewards/api')>()),
  useRewardStore: () => query(),
}))
const session = {
  user: { id: 'b', email: 'b@example.test', email_confirmed_at: '2026-10-19' },
} as Session
const offer: RewardOffer = {
  id: 'offer',
  request_id: 'request',
  space_id: 'space',
  creator_id: 'a',
  partner_id: 'b',
  title: 'Вечер кино',
  description: 'Выбор фильма за вами',
  kind: 'partner',
  category: 'fun',
  emoji: '🎬',
  price: 30,
  single_use: false,
  status: 'active',
  created_at: '2026-10-19T10:00:00Z',
}
const purchase: RewardPurchase = {
  id: 'purchase',
  request_id: 'key',
  offer_id: 'offer',
  space_id: 'space',
  buyer_id: 'b',
  provider_id: 'a',
  title: 'Вечер кино',
  description: '',
  emoji: '🎬',
  kind: 'partner',
  price: 30,
  single_use: false,
  status: 'ready',
  created_at: '2026-10-19T10:00:00Z',
  resolved_at: null,
}
function data(): RewardStore {
  return {
    offers: [offer],
    consents: [],
    purchases: [],
    transactions: [],
    summary: { balance: 50, earned: '80', spent: '30', refunded: '0' },
    couple: {
      space: { id: 'space', created_at: '', archived_at: null },
      members: [
        {
          id: '1',
          space_id: 'space',
          user_id: 'a',
          seat: 1,
          joined_at: '',
          left_at: null,
        },
        {
          id: '2',
          space_id: 'space',
          user_id: 'b',
          seat: 2,
          joined_at: '',
          left_at: null,
        },
      ],
      profiles: [
        {
          id: 'a',
          display_name: 'Анна',
          avatar_url: null,
          created_at: '',
          updated_at: '',
        },
      ],
      invitations: [],
    },
  }
}
function wrapper(children: React.ReactNode, online = true) {
  const rpc = vi.fn().mockResolvedValue({ data: 'purchase', error: null })
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
  return { ...rendered, rpc, cache }
}
beforeEach(() => {
  query.mockReturnValue({ isPending: false, isError: false, data: data() })
  sessionStorage.clear()
  clearPurchaseRequest('b', 'offer')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
test('store shows personal balance, incoming consent, filters and history amounts', async () => {
  const d = data()
  d.offers.push({ ...offer, id: 'joint', kind: 'joint', status: 'pending' })
  query.mockReturnValue({ isPending: false, isError: false, data: d })
  wrapper(<RewardsScreen />)
  expect(await screen.findByText('50 Coins')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Принять предложение' }),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'История' }))
  expect(screen.getByText('Заработано')).toBeInTheDocument()
  expect(screen.getByText('80')).toBeInTheDocument()
  expect(screen.getByText('Покупок пока нет')).toBeInTheDocument()
})
test('solo space preserves coins and waits for a partner without publishing offers', async () => {
  const d = data()
  d.offers = []
  d.couple!.members = d.couple!.members.slice(1)
  query.mockReturnValue({ isPending: false, isError: false, data: d })
  wrapper(<RewardsScreen />)
  expect(
    await screen.findByText('Ждём подключения партнёра'),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Создать награду' })).toBeDisabled()
  expect(screen.getByText('50 Coins')).toBeInTheDocument()
})
test('insufficient coins and offline prevent purchase', async () => {
  const d = data()
  d.summary.balance = 10
  const w = wrapper(<RewardOfferCard offer={offer} data={d} />)
  expect(
    await screen.findByRole('button', { name: 'Получить за 30 Coins' }),
  ).toBeDisabled()
  expect(screen.getByText(/Недостаточно Coins/)).toBeInTheDocument()
  expect(w.rpc).not.toHaveBeenCalled()
  cleanup()
  wrapper(<RewardOfferCard offer={offer} data={data()} />, false)
  expect(
    await screen.findByRole('button', { name: 'Получить за 30 Coins' }),
  ).toBeDisabled()
})
test('purchase requires confirmation, uses server price and retries same key after a lost response', async () => {
  const w = wrapper(<RewardOfferCard offer={offer} data={data()} />)
  const invalidate = vi.spyOn(w.cache, 'invalidateQueries')
  w.rpc
    .mockResolvedValueOnce({
      data: null,
      error: { message: 'Failed to fetch' },
    })
    .mockResolvedValueOnce({ data: 'purchase', error: null })
  fireEvent.click(
    await screen.findByRole('button', { name: 'Получить за 30 Coins' }),
  )
  expect(w.rpc).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Подтвердить за 30 Coins' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи')
  expect(
    screen.queryByText(/Покупка подтверждена сервером/),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить безопасно' }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Покупка подтверждена сервером',
  )
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reward-store'] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['task-workspace'] })
  expect(w.rpc.mock.calls[0][0]).toBe('buy_reward_offer')
  expect(w.rpc.mock.calls[0][1]).toEqual(w.rpc.mock.calls[1][1])
  expect(Object.keys(w.rpc.mock.calls[0][1]).sort()).toEqual([
    'p_expected_purchases',
    'p_offer_id',
    'p_request_id',
  ])
})
test('pending purchase keys survive reopening and remain scoped to the account', () => {
  const id = purchaseRequest('b', 'offer')
  expect(purchaseRequest('b', 'offer')).toBe(id)
  expect(purchaseRequest('a', 'offer')).not.toBe(id)
  clearPurchaseRequest('b', 'offer')
  expect(purchaseRequest('b', 'offer')).not.toBe(id)
})
test('joint consent and refusal are explicit own-actor RPC actions', async () => {
  const w = wrapper(
    <RewardOfferCard
      offer={{ ...offer, kind: 'joint', status: 'pending' }}
      data={data()}
    />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Отклонить' }))
  await waitFor(() =>
    expect(w.rpc).toHaveBeenCalledWith('respond_reward_offer', {
      p_offer_id: 'offer',
      p_accept: false,
    }),
  )
})
test('only buyer confirms receipt; readiness alone is not completed', async () => {
  const w = wrapper(<PurchaseCard purchase={purchase} data={data()} />)
  expect(await screen.findByText(/Готовность подтверждена/)).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Готов(а) исполнить' }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Я получил(а) награду' }))
  await waitFor(() =>
    expect(w.rpc).toHaveBeenCalledWith('act_reward_purchase', {
      p_purchase_id: 'purchase',
      p_action: 'confirm',
    }),
  )
})
test('cancellation calls refund RPC without client amount; SQL errors stay private', async () => {
  const w = wrapper(
    <PurchaseCard
      purchase={{ ...purchase, status: 'pending' }}
      data={data()}
    />,
  )
  w.rpc.mockResolvedValue({
    data: null,
    error: { message: 'SQL constraint private uuid user_id' },
  })
  fireEvent.click(
    await screen.findByRole('button', { name: 'Отменить с возвратом' }),
  )
  expect(await screen.findByRole('alert')).not.toHaveTextContent('SQL')
  expect(w.rpc).toHaveBeenCalledWith('act_reward_purchase', {
    p_purchase_id: 'purchase',
    p_action: 'cancel',
  })
  expect(screen.queryByText(/Coins возвращены/)).not.toBeInTheDocument()
})
test('reward form validates cost and sends only offer fields with stable create key', async () => {
  const close = vi.fn()
  const w = wrapper(<RewardForm close={close} />)
  fireEvent.change(await screen.findByLabelText('Название'), {
    target: { value: 'Утренний кофе' },
  })
  fireEvent.change(screen.getByLabelText('Стоимость в Coins'), {
    target: { value: '0' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Предложить награду' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('От 1 Coin')
  expect(w.rpc).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Стоимость в Coins'), {
    target: { value: '30' },
  })
  w.rpc
    .mockResolvedValueOnce({
      data: null,
      error: { message: 'Failed to fetch' },
    })
    .mockResolvedValueOnce({ data: 'offer', error: null })
  fireEvent.click(screen.getByRole('button', { name: 'Предложить награду' }))
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Нет связи'),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Предложить награду' }))
  await waitFor(() => expect(close).toHaveBeenCalled())
  expect(w.rpc.mock.calls[0][1]).toEqual(w.rpc.mock.calls[1][1])
  expect(w.rpc.mock.calls[0][1]).not.toHaveProperty('p_user_id')
})
test('demo has examples but cannot create sessions or spend/refund', () => {
  render(<DemoRewardStore />)
  expect(screen.getByText(/Пример магазина · деморежим/)).toBeInTheDocument()
  for (const button of screen.getAllByRole('button'))
    expect(button).toBeDisabled()
})
test('loading, empty and safe error states are present', async () => {
  query.mockReturnValue({ isPending: true })
  wrapper(<RewardsScreen />)
  expect(await screen.findByRole('status')).toHaveTextContent('Загружаем')
  cleanup()
  query.mockReturnValue({
    isPending: false,
    isError: true,
    error: { message: 'SQL auth.users private' },
    refetch: vi.fn(),
  })
  wrapper(<RewardsScreen />)
  expect(await screen.findByRole('alert')).not.toHaveTextContent('SQL')
  cleanup()
  const d = data()
  d.offers = []
  query.mockReturnValue({ isPending: false, isError: false, data: d })
  wrapper(<RewardsScreen />)
  expect(
    await screen.findByText('Здесь появятся ваши награды'),
  ).toBeInTheDocument()
})

test('reload restores unresolved UUID; storage loss in a new runtime creates a new UUID requiring server fencing', async () => {
  const original = purchaseRequest('reload-user', 'reload-offer')
  vi.resetModules()
  const reloaded = await import('../features/rewards/purchase-request')
  expect(reloaded.purchaseRequest('reload-user', 'reload-offer')).toBe(original)
  sessionStorage.clear()
  vi.resetModules()
  const lost = await import('../features/rewards/purchase-request')
  expect(lost.purchaseRequest('reload-user', 'reload-offer')).not.toBe(original)
})
test('isolated tabs can have different UUIDs, while disabled storage retains an in-memory retry UUID', async () => {
  let tab = new Map<string, string>()
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
    (key) => tab.get(key) ?? null,
  )
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
    tab.set(key, value)
  })
  vi.resetModules()
  const first = await import('../features/rewards/purchase-request')
  const a = first.purchaseRequest('tabs', 'offer')
  tab = new Map()
  vi.resetModules()
  const second = await import('../features/rewards/purchase-request')
  expect(second.purchaseRequest('tabs', 'offer')).not.toBe(a)
  vi.mocked(Storage.prototype.getItem).mockImplementation(() => {
    throw Error('storage disabled')
  })
  vi.mocked(Storage.prototype.setItem).mockImplementation(() => {
    throw Error('storage disabled')
  })
  expect(first.purchaseRequest('tabs', 'offer')).toBe(a)
})
test('recovery stays enabled after debit consumes balance or a single-use offer is sold', async () => {
  purchaseRequest('b', 'offer')
  const d = data()
  d.summary.balance = 0
  d.purchases = [purchase]
  const w = wrapper(
    <RewardOfferCard offer={{ ...offer, single_use: true }} data={d} />,
  )
  const check = await screen.findByRole('button', {
    name: 'Проверить предыдущую покупку',
  })
  expect(check).toBeEnabled()
  fireEvent.click(check)
  fireEvent.click(screen.getByRole('button', { name: 'Повторить безопасно' }))
  await waitFor(() => expect(w.rpc).toHaveBeenCalled())
  expect(w.rpc.mock.calls[0][1].p_request_id).toBeTruthy()
})
test('fresh purchase after reload with existing history explicitly warns of a separate debit', async () => {
  const d = data()
  d.purchases = [purchase]
  const w = wrapper(<RewardOfferCard offer={offer} data={d} />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Купить ещё за 30 Coins' }),
  )
  expect(screen.getByText(/Это отдельная новая покупка/)).toBeInTheDocument()
  expect(w.rpc).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Подтвердить за 30 Coins' }),
  )
  await waitFor(() =>
    expect(w.rpc).toHaveBeenCalledWith(
      'buy_reward_offer',
      expect.objectContaining({ p_expected_purchases: 1 }),
    ),
  )
})
test('stale tab failure never shows success and asks to inspect refreshed history', async () => {
  const w = wrapper(<RewardOfferCard offer={offer} data={data()} />)
  w.rpc.mockResolvedValue({
    data: null,
    error: { message: 'reward_purchase_changed' },
  })
  fireEvent.click(
    await screen.findByRole('button', { name: 'Получить за 30 Coins' }),
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Подтвердить за 30 Coins' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'История покупок изменилась',
  )
  expect(
    screen.queryByText(/Покупка подтверждена сервером/),
  ).not.toBeInTheDocument()
})
test('joint purchase labels the other participant clearly and never lets them confirm receipt', async () => {
  const w = wrapper(
    <PurchaseCard
      purchase={{
        ...purchase,
        kind: 'joint',
        buyer_id: 'a',
        provider_id: 'b',
        status: 'pending',
      }}
      data={data()}
    />,
  )
  expect(await screen.findByText(/Второй участник: Вы/)).toBeInTheDocument()
  expect(
    screen.getByText(/Это совместное событие: оба участвуют добровольно/),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Я получил(а) награду' }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Готов(а) исполнить' }))
  await waitFor(() =>
    expect(w.rpc).toHaveBeenCalledWith('act_reward_purchase', {
      p_purchase_id: 'purchase',
      p_action: 'ready',
    }),
  )
})
test('retry never adopts a newer purchase counter, including after a full module reload', async () => {
  vi.resetModules()
  const first = await import('../features/rewards/purchase-request')
  const intent = first.purchaseIntent('fenced', 'offer', 0)
  expect(first.purchaseIntent('fenced', 'offer', 1)).toEqual(intent)
  vi.resetModules()
  const reload = await import('../features/rewards/purchase-request')
  expect(reload.purchaseIntent('fenced', 'offer', 2)).toEqual(intent)
})
test('legacy unresolved UUID never adopts the latest history counter', async () => {
  const id = crypto.randomUUID()
  sessionStorage.setItem('kolo-purchase:legacy:offer', id)
  vi.resetModules()
  const legacy = await import('../features/rewards/purchase-request')
  expect(legacy.purchaseIntent('legacy', 'offer', 3)).toEqual({
    request: id,
    expected: 0,
  })
})
