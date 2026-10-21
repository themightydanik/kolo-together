// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import {
  Action,
  PlayingCard,
  DemoConnection,
  ConnectionHub,
} from '../features/connection/screens'
import {
  catalog,
  compareAnswers,
  connectionError,
} from '../features/connection/model'
const state = vi.hoisted(() => ({
  write: vi.fn(),
  rpc: vi.fn(),
  online: true,
  client: true,
}))
vi.mock('../features/auth/auth-context', () => ({
  useAuth: () => ({
    session: { user: { id: 'owner' } },
    online: state.online,
    client: state.client ? { rpc: state.rpc } : null,
  }),
}))
vi.mock('../features/connection/api', () => ({
  useConnectionWrite: () => ({ mutateAsync: state.write, isPending: false }),
  useConnection: () => ({ isPending: false, error: null, data: null }),
  useConnectionPages: () => ({
    isPending: false,
    error: null,
    data: { pages: [{ items: [] }] },
  }),
}))
beforeEach(() => {
  state.write.mockReset().mockResolvedValue({})
  state.rpc.mockReset()
  state.online = true
  state.client = true
  sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
const action = (expected = 0, payload = { title: 'початкове' }) => (
  <Action action="start_game" expected={expected} payload={payload}>
    Почати гру
  </Action>
)
test('150 unique Ukrainian questions with stable IDs, five groups of thirty and no placeholders', () => {
  expect(catalog.cards).toHaveLength(150)
  expect(new Set(catalog.cards.map((c) => c.id)).size).toBe(150)
  expect(new Set(catalog.cards.map((c) => c.text)).size).toBe(150)
  for (const c of catalog.categories)
    expect(catalog.cards.filter((x) => x.category === c.id)).toHaveLength(30)
  for (const c of catalog.cards) {
    expect(c.text).toMatch(/\?$/)
    expect(c.text).not.toMatch(/[ыъэё]|placeholder|TODO/i)
  }
})
test('eight original ten-question questionnaires with all three declared question types', () => {
  expect(catalog.questionnaires).toHaveLength(8)
  for (const q of catalog.questionnaires) {
    expect(q.questions).toHaveLength(10)
    expect(new Set(q.questions.map((x) => x.type))).toEqual(
      new Set(['scale', 'choice', 'priority']),
    )
  }
})
test('analysis is deterministic, ordinal only for scales, semantic for options independent of array order', () => {
  const q = structuredClone(catalog.questionnaires[0]),
    a = Object.fromEntries(
      q.questions.map((x) => [x.id, x.type === 'scale' ? '1' : 'talk']),
    ),
    b = { ...a, 'care-01': '5', 'care-09': 'time' }
  const r = compareAnswers(q, a, b)
  expect(r.different.map((p) => p.id)).toContain('care-01')
  expect(r.different.map((p) => p.id)).toContain('care-09')
  expect(r.prompts).toHaveLength(3)
  expect(r.actions).toHaveLength(3)
  q.questions.forEach((x) => x.options.reverse())
  expect(compareAnswers(q, a, b)).toEqual(r)
  expect(compareAnswers(q, a, b)).toEqual(compareAnswers(q, a, b))
})
test('card flips by click using a native keyboard-accessible button; flip performs no write', () => {
  render(<PlayingCard card={catalog.cards[0]} number={1} remaining={149} />)
  const b = screen.getByRole('button', { name: 'Перевернути картку' })
  expect(b).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(b)
  expect(b).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(b)
  expect(b).toHaveAttribute('aria-pressed', 'false')
  expect(state.write).not.toHaveBeenCalled()
})
test('card carries category name, unique symbol, question and small card number', () => {
  render(<PlayingCard card={catalog.cards[60]} number={61} remaining={89} />)
  expect(screen.getByText('Довіра')).toBeVisible()
  expect(screen.getByText(catalog.cards[60].text)).toBeVisible()
  expect(screen.getByText('061 · Між нами')).toBeVisible()
})
test('longest catalog question is rendered as text, never HTML', () => {
  const c = catalog.cards.reduce((a, b) =>
    a.text.length > b.text.length ? a : b,
  )
  render(<PlayingCard card={c} number={9} remaining={141} />)
  expect(screen.getByText(c.text)).toBeVisible()
  expect(document.querySelector('script')).toBeNull()
})
test('unknown write response retains original UUID, payload and counter across rerender', async () => {
  state.write.mockRejectedValueOnce(Error('Failed to fetch'))
  const v = render(action())
  fireEvent.click(screen.getByRole('button', { name: 'Почати гру' }))
  await screen.findByRole('button', { name: 'Перевірити результат' })
  v.rerender(action(3, { title: 'змінене' }))
  fireEvent.click(
    screen.getByRole('button', { name: 'Повторити початковий запит' }),
  )
  await waitFor(() => expect(state.write).toHaveBeenCalledTimes(2))
  expect(state.write.mock.calls[1][0]).toEqual(state.write.mock.calls[0][0])
  expect(state.write.mock.calls[0][0].expected).toBe(0)
})
test('reload restores unknown intent; mounting and reconnect never resubmit it', async () => {
  state.write.mockRejectedValue(Error('offline'))
  const v = render(action())
  fireEvent.click(screen.getByRole('button', { name: 'Почати гру' }))
  await screen.findByRole('button', { name: 'Перевірити результат' })
  const first = state.write.mock.calls[0][0]
  v.unmount()
  render(action(9))
  expect(state.write).toHaveBeenCalledTimes(1)
  fireEvent.click(
    screen.getByRole('button', { name: 'Повторити початковий запит' }),
  )
  await waitFor(() => expect(state.write).toHaveBeenCalledTimes(2))
  expect(state.write.mock.calls[1][0]).toEqual(first)
})
test('disabled sessionStorage uses memory fallback and the same UUID for explicit retry', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw Error('disabled')
  })
  state.write.mockRejectedValueOnce(Error('timeout'))
  render(action())
  fireEvent.click(screen.getByRole('button', { name: 'Почати гру' }))
  await screen.findByRole('button', { name: 'Перевірити результат' })
  fireEvent.click(
    screen.getByRole('button', { name: 'Повторити початковий запит' }),
  )
  await waitFor(() => expect(state.write).toHaveBeenCalledTimes(2))
  expect(state.write.mock.calls[1][0].request).toBe(
    state.write.mock.calls[0][0].request,
  )
})
test('checking an unknown result uses SELECT-only RPC and never starts a new game', async () => {
  state.write.mockRejectedValueOnce(Error('timeout'))
  state.rpc.mockResolvedValue({ data: { data: { id: 'found' } }, error: null })
  render(action())
  fireEvent.click(screen.getByRole('button', { name: 'Почати гру' }))
  await screen.findByRole('button', { name: 'Перевірити результат' })
  fireEvent.click(screen.getByRole('button', { name: 'Перевірити результат' }))
  await screen.findByText('Запит уже виконано. Оновіть дані.')
  expect(state.rpc).toHaveBeenCalledWith(
    'connection_read',
    expect.objectContaining({ p_view: 'request' }),
  )
  expect(state.write).toHaveBeenCalledTimes(1)
})
test('offline state disables writes without queuing a server operation', () => {
  state.online = false
  render(action())
  expect(screen.getByRole('button', { name: 'Почати гру' })).toBeDisabled()
  expect(screen.getByText(/Нічого не буде надіслано автоматично/)).toBeVisible()
  expect(state.write).not.toHaveBeenCalled()
})
test('demo has no fake save or submit actions', () => {
  render(<DemoConnection />)
  expect(
    screen.getByText(
      /Настрій, відповіді, згоди та серверна історія не зберігаються/,
    ),
  ).toBeVisible()
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(state.write).not.toHaveBeenCalled()
})
test('existing Us navigation links to three features without a sixth main section', () => {
  state.client = false
  render(
    <MemoryRouter>
      <ConnectionHub mode="game" />
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: 'Наш настрій' })).toHaveAttribute(
    'href',
    '/us/connection/mood',
  )
  expect(
    screen.getByRole('link', { name: 'Опитування для двох' }),
  ).toBeVisible()
})
test('SQL errors are never shown to people', () => {
  expect(
    connectionError(Error('relation private_secret does not exist at SQL 42')),
  ).not.toContain('private_secret')
  expect(connectionError(Error('connection_categories_locked'))).toContain(
    'добровільно',
  )
})
