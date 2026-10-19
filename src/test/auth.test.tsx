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
import { StrictMode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider } from '../features/auth/auth-provider'
import type { AppClient } from '../features/auth/auth-context'
import {
  AuthScreen,
  CallbackScreen,
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
  access_token: 'test-access',
  user: {
    id: 'user-1',
    email: 'anna@example.test',
    email_confirmed_at: '2026-10-19T12:00:00Z',
  },
} as Session
function clientMock(initial: Session | null = null) {
  const listeners = new Set<(event: string, value: Session | null) => void>()
  const client = {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: initial }, error: null }),
      onAuthStateChange: vi.fn(
        (fn: (event: string, value: Session | null) => void) => {
          listeners.add(fn)
          return {
            data: { subscription: { unsubscribe: () => listeners.delete(fn) } },
          }
        },
      ),
      exchangeCodeForSession: vi.fn(),
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
    emit: (
      value: Session | null,
      event = value ? 'SIGNED_IN' : 'SIGNED_OUT',
    ) => {
      for (const listener of listeners) listener(event, value)
    },
  }
}
function renderAuth(
  mock: ReturnType<typeof clientMock>,
  element: React.ReactNode,
  path = '/',
  strict = false,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const tree = (
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={mock.client}>
        <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
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
  await waitFor(() => expect(mock.raw.auth.getSession).toHaveBeenCalled())
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
  await screen.findByText(/Форма доступна только/)
  act(() => active.emit(session, 'PASSWORD_RECOVERY'))
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

test('a normal restored session or SIGNED_IN event never enables password recovery', async () => {
  const mock = clientMock(session)
  renderAuth(mock, <UpdatePasswordScreen />)
  expect(await screen.findByText(/Форма доступна только/)).toBeVisible()
  act(() => mock.emit(session))
  expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument()
  expect(mock.raw.auth.updateUser).not.toHaveBeenCalled()
})
test.each(['confirmation', 'recovery'])(
  'successful PKCE %s callback is explicitly exchanged and scrubbed',
  async (kind) => {
    const path =
      kind === 'recovery' ? '/auth/update-password' : '/auth/callback'
    window.history.replaceState(
      {},
      '',
      `${path}?code=one-use-test-code&sb_flow_id=test-flow`,
    )
    const mock = clientMock()
    mock.raw.auth.exchangeCodeForSession.mockImplementation(async () => {
      mock.raw.auth.getSession.mockResolvedValue({
        data: { session },
        error: null,
      })
      mock.emit(
        session,
        kind === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN',
      )
      return { data: { session, user: session.user }, error: null }
    })
    renderAuth(
      mock,
      <Routes>
        <Route path="/auth/callback" element={<CallbackScreen />} />
        <Route
          path="/auth/update-password"
          element={<UpdatePasswordScreen />}
        />
        <Route path="/" element={<p>Email confirmed</p>} />
      </Routes>,
      path,
    )
    if (kind === 'recovery')
      expect(await screen.findByLabelText('Новый пароль')).toBeVisible()
    else expect(await screen.findByText('Email confirmed')).toBeVisible()
    expect(
      mock.raw.auth.exchangeCodeForSession,
    ).toHaveBeenCalledExactlyOnceWith('one-use-test-code', {
      flowId: 'test-flow',
    })
    expect(window.location.search).toBe('')
  },
)
test.each(['/auth/callback', '/auth/update-password'])(
  'expired or failed PKCE on %s cannot borrow an existing session',
  async (path) => {
    window.history.replaceState({}, '', `${path}?code=expired-code`)
    const mock = clientMock(session)
    mock.raw.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { code: 'flow_state_expired', message: 'SQL sensitive detail' },
    })
    renderAuth(
      mock,
      path === '/auth/callback' ? <CallbackScreen /> : <UpdatePasswordScreen />,
      path,
    )
    expect(
      await screen.findByText(
        path === '/auth/callback'
          ? /Ссылка не подтверждена/
          : /Форма доступна только/,
      ),
    ).toBeVisible()
    expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument()
    expect(screen.queryByText(/SQL sensitive/)).not.toBeInTheDocument()
    expect(mock.raw.auth.updateUser).not.toHaveBeenCalled()
  },
)
test.each(['/auth/callback', '/auth/update-password'])(
  'Auth URL error on %s is handled before the old session and never echoed',
  async (path) => {
    window.history.replaceState(
      {},
      '',
      `${path}?error=access_denied&error_code=otp_expired&error_description=SQL-secret`,
    )
    const mock = clientMock(session)
    renderAuth(
      mock,
      path === '/auth/callback' ? <CallbackScreen /> : <UpdatePasswordScreen />,
      path,
    )
    expect(
      await screen.findByText(
        path === '/auth/callback'
          ? /Ссылка не подтверждена/
          : /Форма доступна только/,
      ),
    ).toBeVisible()
    expect(mock.raw.auth.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(screen.queryByText(/SQL-secret/)).not.toBeInTheDocument()
    expect(window.location.search).toBe('')
  },
)
test('a valid confirmation code on the password route does not authorize a password change', async () => {
  window.history.replaceState(
    {},
    '',
    '/auth/update-password?code=confirmation-code&type=recovery',
  )
  const mock = clientMock(session)
  mock.raw.auth.exchangeCodeForSession.mockImplementation(async () => {
    mock.emit(session, 'SIGNED_IN')
    return { data: { session }, error: null }
  })
  renderAuth(mock, <UpdatePasswordScreen />, '/auth/update-password')
  expect(await screen.findByText(/Форма доступна только/)).toBeVisible()
  expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument()
})

test('Strict Mode does not exchange a one-use recovery code twice', async () => {
  window.history.replaceState(
    {},
    '',
    '/auth/update-password?code=strict-mode-code',
  )
  const mock = clientMock()
  mock.raw.auth.exchangeCodeForSession.mockImplementation(async () => {
    await Promise.resolve()
    mock.raw.auth.getSession.mockResolvedValue({
      data: { session },
      error: null,
    })
    mock.emit(session, 'PASSWORD_RECOVERY')
    return { data: { session }, error: null }
  })
  renderAuth(mock, <UpdatePasswordScreen />, '/auth/update-password', true)
  expect(await screen.findByLabelText('Новый пароль')).toBeVisible()
  expect(mock.raw.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
})
test('failed verifier exchange does not expose the form or exception text', async () => {
  window.history.replaceState(
    {},
    '',
    '/auth/update-password?code=verifier-error',
  )
  const mock = clientMock(session)
  mock.raw.auth.exchangeCodeForSession.mockRejectedValue(
    new Error('PKCE verifier missing, internal SQL'),
  )
  renderAuth(mock, <UpdatePasswordScreen />, '/auth/update-password')
  expect(await screen.findByText(/Форма доступна только/)).toBeVisible()
  expect(screen.queryByText(/internal SQL/)).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument()
})
test('signing out revokes an in-memory recovery grant', async () => {
  const mock = clientMock(session)
  renderAuth(mock, <UpdatePasswordScreen />)
  await screen.findByText(/Форма доступна только/)
  act(() => mock.emit(session, 'PASSWORD_RECOVERY'))
  expect(await screen.findByLabelText('Новый пароль')).toBeVisible()
  act(() => mock.emit(null))
  expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument()
  act(() => mock.emit(session))
  expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument()
})

test('completed recovery proof cannot be reused after provider remount', async () => {
  window.history.replaceState({}, '', '/auth/update-password?code=one-recovery')
  const mock = clientMock()
  mock.raw.auth.exchangeCodeForSession.mockImplementation(async () => {
    mock.raw.auth.getSession.mockResolvedValue({
      data: { session },
      error: null,
    })
    mock.emit(session, 'PASSWORD_RECOVERY')
    return { data: { session }, error: null }
  })
  renderAuth(mock, <UpdatePasswordScreen />, '/auth/update-password')
  fireEvent.change(await screen.findByLabelText('Новый пароль'), {
    target: { value: 'updated-password' },
  })
  fireEvent.change(screen.getByLabelText('Повторите пароль'), {
    target: { value: 'updated-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить пароль' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Пароль обновлён')
  cleanup()
  renderAuth(mock, <UpdatePasswordScreen />, '/auth/update-password')
  expect(await screen.findByText(/Форма доступна только/)).toBeVisible()
  expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument()
  expect(mock.raw.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
})
test('expired in-memory recovery authorization is checked again at submit', async () => {
  const mock = clientMock(session)
  renderAuth(mock, <UpdatePasswordScreen />)
  await screen.findByText(/Форма доступна только/)
  act(() => mock.emit(session, 'PASSWORD_RECOVERY'))
  fireEvent.change(await screen.findByLabelText('Новый пароль'), {
    target: { value: 'updated-password' },
  })
  fireEvent.change(screen.getByLabelText('Повторите пароль'), {
    target: { value: 'updated-password' },
  })
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000)
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить пароль' }))
  expect(await screen.findByText(/Форма доступна только/)).toBeVisible()
  expect(mock.raw.auth.updateUser).not.toHaveBeenCalled()
})

test('a session-read Auth event cannot leave a recovery proof reusable', async () => {
  window.history.replaceState({}, '', '/auth/update-password?code=session-race')
  const mock = clientMock()
  mock.raw.auth.exchangeCodeForSession.mockImplementation(async () => {
    mock.emit(session, 'PASSWORD_RECOVERY')
    mock.raw.auth.getSession
      .mockImplementationOnce(async () => {
        mock.emit(session, 'TOKEN_REFRESHED')
        return { data: { session }, error: null }
      })
      .mockResolvedValue({ data: { session }, error: null })
    return { data: { session }, error: null }
  })
  renderAuth(mock, <UpdatePasswordScreen />, '/auth/update-password')
  expect(await screen.findByLabelText('Новый пароль')).toBeVisible()
  cleanup()
  renderAuth(mock, <UpdatePasswordScreen />, '/auth/update-password')
  expect(await screen.findByText(/Форма доступна только/)).toBeVisible()
  expect(mock.raw.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
})
