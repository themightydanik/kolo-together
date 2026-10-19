// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider } from '../features/auth/auth-provider'
import type { AppClient } from '../features/auth/auth-context'
import {
  AuthScreen,
  ProtectedRoute,
  UpdatePasswordScreen,
} from '../features/auth/auth-screens'
import {
  AcceptInvitationScreen,
  CoupleStatus,
} from '../features/couple/screens'
import {
  captureInvitationToken,
  invitationToken,
} from '../features/auth/invitation-token'
const session = {
  user: {
    id: 'user-1',
    email: 'anna@example.test',
    email_confirmed_at: '2026-10-19T12:00:00Z',
  },
} as Session
function clientMock(initial: Session | null = null) {
  let listener: ((event: string, value: Session | null) => void) | undefined
  const client = {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: initial }, error: null }),
      onAuthStateChange: vi.fn((fn: typeof listener) => {
        listener = fn
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
      signUp: vi.fn().mockResolvedValue({
        data: { session: null, user: null },
        error: null,
      }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: vi.fn().mockImplementation((name: string) =>
      Promise.resolve(
        name === 'inspect_couple_invitation'
          ? {
              data: [{ space_id: 'space', expires_at: '2099-10-19T12:00:00Z' }],
              error: null,
            }
          : { data: 'space', error: null },
      ),
    ),
    from: vi.fn(),
  }
  return {
    client: client as unknown as AppClient,
    raw: client,
    emit: (value: Session | null) =>
      listener?.(value ? 'SIGNED_IN' : 'SIGNED_OUT', value),
  }
}
function renderAuth(
  mock: ReturnType<typeof clientMock>,
  element: React.ReactNode,
  path = '/',
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={mock.client}>
        <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})
test('protected routes wait for session restoration, redirect anonymous users and accept real restored session', async () => {
  const mock = clientMock()
  let finish: (value: unknown) => void = () => {}
  mock.raw.auth.getSession.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  renderAuth(
    mock,
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/private" element={<p>Private page</p>} />
      </Route>
      <Route path="/auth/login" element={<p>Login page</p>} />
    </Routes>,
    '/private',
  )
  expect(screen.getByRole('status')).toHaveTextContent('Загружаем')
  expect(screen.queryByText('Private page')).not.toBeInTheDocument()
  await act(async () => finish({ data: { session: null }, error: null }))
  expect(await screen.findByText('Login page')).toBeVisible()
  cleanup()
  renderAuth(
    clientMock(session),
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/private" element={<p>Private page</p>} />
      </Route>
    </Routes>,
    '/private',
  )
  expect(await screen.findByText('Private page')).toBeVisible()
})
test('auth signout event immediately removes protected content', async () => {
  const mock = clientMock(session)
  renderAuth(
    mock,
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<p>Private page</p>} />
      </Route>
      <Route path="/auth/login" element={<p>Login page</p>} />
    </Routes>,
  )
  expect(await screen.findByText('Private page')).toBeVisible()
  act(() => mock.emit(null))
  expect(await screen.findByText('Login page')).toBeVisible()
  expect(screen.queryByText('Private page')).not.toBeInTheDocument()
})
test('registration uses email/password, confirmation callback and never invents a session', async () => {
  const mock = clientMock()
  renderAuth(mock, <AuthScreen mode="register" />, '/auth/register')
  fireEvent.change(await screen.findByLabelText('Email'), {
    target: { value: 'anna@example.test' },
  })
  fireEvent.change(screen.getByLabelText('Пароль'), {
    target: { value: 'long-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Проверьте почту')
  expect(mock.raw.auth.signUp).toHaveBeenCalledWith({
    email: 'anna@example.test',
    password: 'long-password',
    options: { emailRedirectTo: expect.stringContaining('/auth/callback') },
  })
  expect(
    screen.getByRole('button', { name: 'Зарегистрироваться' }),
  ).toBeVisible()
})
test('auth errors are translated and network errors permit retry', async () => {
  const mock = clientMock()
  mock.raw.auth.signInWithPassword
    .mockResolvedValueOnce({ error: { code: 'invalid_credentials' } })
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
  renderAuth(mock, <AuthScreen mode="login" />)
  fireEvent.change(await screen.findByLabelText('Email'), {
    target: { value: 'anna@example.test' },
  })
  fireEvent.change(screen.getByLabelText('Пароль'), {
    target: { value: 'wrong' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Неверный email или пароль',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Войти' }))
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Нет связи с сервером'),
  )
})
test('password recovery sends redirect, then saves a validated new password for a real session', async () => {
  const mock = clientMock()
  renderAuth(mock, <AuthScreen mode="reset" />)
  fireEvent.change(await screen.findByLabelText('Email'), {
    target: { value: 'anna@example.test' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Отправить письмо' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Если аккаунт')
  expect(mock.raw.auth.resetPasswordForEmail).toHaveBeenCalledWith(
    'anna@example.test',
    { redirectTo: expect.stringContaining('/auth/update-password') },
  )
  cleanup()
  const active = clientMock(session)
  renderAuth(active, <UpdatePasswordScreen />)
  fireEvent.change(await screen.findByLabelText('Новый пароль'), {
    target: { value: 'new-password' },
  })
  fireEvent.change(screen.getByLabelText('Повторите пароль'), {
    target: { value: 'new-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить пароль' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Пароль обновлён')
  expect(active.raw.auth.updateUser).toHaveBeenCalledWith({
    password: 'new-password',
  })
})
test('unconnected partner state allows solo use and offers an invitation', async () => {
  const mock = clientMock(session)
  const membership = { space_id: 'space', user_id: session.user.id }
  mock.raw.from.mockImplementation((table: string) => {
    const value =
      table === 'couple_members'
        ? { data: [membership], error: null }
        : table === 'couple_spaces'
          ? { data: { id: 'space' }, error: null }
          : table === 'profiles'
            ? {
                data: [{ id: session.user.id, display_name: 'Анна' }],
                error: null,
              }
            : { data: [], error: null }
    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve(value).then(resolve),
    }
    for (const method of ['select', 'eq', 'is', 'order', 'limit', 'in'])
      chain[method] = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: membership, error: null })
    chain.single = () => Promise.resolve(value)
    return chain
  })
  renderAuth(mock, <CoupleStatus />)
  expect(await screen.findByText(/Партнёр пока не подключён/)).toBeVisible()
  expect(
    screen.getByRole('link', { name: 'Пригласить партнёра' }),
  ).toHaveAttribute('href', '/space/invite')
})
test.each([true, false])(
  'invitation %s resolves through RPC and consumes only after success',
  async (accept) => {
    window.history.replaceState({}, '', '/invite#token=' + 'a'.repeat(64))
    captureInvitationToken()
    expect(window.location.hash).toBe('')
    expect(invitationToken()).toBe('a'.repeat(64))
    const mock = clientMock(session)
    renderAuth(
      mock,
      <Routes>
        <Route path="/invite" element={<AcceptInvitationScreen />} />
        <Route path="/us" element={<p>Connected</p>} />
        <Route path="/" element={<p>Declined</p>} />
      </Routes>,
      '/invite',
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: accept ? 'Принять приглашение' : 'Отклонить',
      }),
    )
    expect(
      await screen.findByText(accept ? 'Connected' : 'Declined'),
    ).toBeVisible()
    expect(mock.raw.rpc).toHaveBeenCalledWith('resolve_couple_invitation', {
      p_token: 'a'.repeat(64),
      p_accept: accept,
    })
    expect(invitationToken()).toBeNull()
  },
)
test('failed invitation acceptance shows server error and retains invitation for retry', async () => {
  window.history.replaceState({}, '', '/invite#token=' + 'b'.repeat(64))
  captureInvitationToken()
  const mock = clientMock(session)
  mock.raw.rpc.mockImplementation((name: string) =>
    Promise.resolve(
      name === 'inspect_couple_invitation'
        ? {
            data: [{ space_id: 'space', expires_at: '2099-10-19' }],
            error: null,
          }
        : { data: null, error: { message: 'already_in_space' } },
    ),
  )
  renderAuth(mock, <AcceptInvitationScreen />, '/invite')
  fireEvent.click(
    await screen.findByRole('button', { name: 'Принять приглашение' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Вы уже в пространстве',
  )
  expect(invitationToken()).toBe('b'.repeat(64))
})

test('offline auth disables requests until the network returns', async () => {
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const mock = clientMock()
  renderAuth(mock, <AuthScreen mode="login" />)
  expect(await screen.findByRole('button', { name: 'Войти' })).toBeDisabled()
  expect(mock.raw.auth.signInWithPassword).not.toHaveBeenCalled()
  online.mockReturnValue(true)
  act(() => window.dispatchEvent(new Event('online')))
  expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled()
})
test('session restoration errors expose a retry without showing protected content', async () => {
  const mock = clientMock()
  mock.raw.auth.getSession.mockRejectedValueOnce(
    new TypeError('Failed to fetch'),
  )
  renderAuth(
    mock,
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<p>Private</p>} />
      </Route>
      <Route path="/auth/login" element={<p>Login</p>} />
    </Routes>,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи')
  expect(screen.queryByText('Private')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  expect(await screen.findByText('Login')).toBeVisible()
})
