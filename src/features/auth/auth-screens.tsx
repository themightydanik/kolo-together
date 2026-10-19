import { useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from './auth-context'
import { authDestination, authRedirect } from './invitation-token'
import { errorMessage } from '../../lib/errors'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { LoadingState } from '../../components/states'

export function ProtectedRoute() {
  const { session, loading, error, retry } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingState />
  if (error)
    return (
      <Card>
        <p role="alert">{error}</p>
        <Button onClick={retry}>Повторить</Button>
      </Card>
    )
  if (!session)
    return (
      <Navigate to="/auth/login" state={{ from: location.pathname }} replace />
    )
  if (!session.user.email_confirmed_at) return <VerifyEmailScreen />
  return <Outlet />
}
function VerifyEmailScreen() {
  const { client, session, online } = useAuth()
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function action(resend: boolean) {
    setBusy(true)
    setMessage(null)
    try {
      const result = resend
        ? await client!.auth.resend({
            type: 'signup',
            email: session!.user.email!,
            options: { emailRedirectTo: authRedirect('/auth/callback') },
          })
        : await client!.auth.signOut({ scope: 'local' })
      if (result.error) throw result.error
      if (resend) setMessage('Письмо отправлено. Проверьте почту.')
    } catch (e) {
      setMessage(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <p>Подтвердите email по ссылке из письма, затем войдите снова.</p>
      {message && <p role="status">{message}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={busy || !online}
          onClick={() => {
            void action(true)
          }}
        >
          Отправить письмо ещё раз
        </Button>
        <Button
          variant="outline"
          disabled={busy || !online}
          onClick={() => {
            void action(false)
          }}
        >
          Выйти из аккаунта
        </Button>
      </div>
    </Card>
  )
}
const schema = z.object({
  email: z.string().trim().email('Введите корректный email'),
  password: z.string().min(8, 'Минимум 8 символов'),
})
type FormData = z.infer<typeof schema>
export function AuthScreen({ mode }: { mode: 'login' | 'register' | 'reset' }) {
  const { client, session, loading, online } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(
      mode === 'reset'
        ? schema.extend({ password: z.string() })
        : mode === 'login'
          ? schema.extend({ password: z.string().min(1, 'Введите пароль') })
          : schema,
    ),
    defaultValues: { email: '', password: '' },
  })
  if (loading) return <LoadingState />
  if (!client) return <Navigate to="/" replace />
  if (session?.user.email_confirmed_at && mode !== 'reset')
    return <Navigate to={authDestination()} replace />
  const title =
    mode === 'login'
      ? 'Рады видеть вас'
      : mode === 'register'
        ? 'Начнём ваше KOLO'
        : 'Восстановить пароль'
  async function submit(values: FormData) {
    if (!client || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (!online) throw new Error('offline')
      if (mode === 'register') {
        const { error } = await client.auth.signUp({
          email: values.email,
          password: values.password,
          options: { emailRedirectTo: authRedirect('/auth/callback') },
        })
        if (error) throw error
        setNotice(
          'Проверьте почту и подтвердите email по ссылке. Затем вернитесь сюда для входа. Если аккаунт уже существует, используйте вход или восстановление.',
        )
      } else if (mode === 'login') {
        const { error } = await client.auth.signInWithPassword(values)
        if (error) throw error
      } else {
        const { error } = await client.auth.resetPasswordForEmail(
          values.email,
          { redirectTo: authRedirect('/auth/update-password') },
        )
        if (error) throw error
        setNotice(
          'Если аккаунт с таким email существует, мы отправили ссылку для смены пароля.',
        )
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="mx-auto max-w-md">
      <h2 className="mb-5 text-xl font-semibold">{title}</h2>
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <label className="block">
          Email
          <input
            className="field"
            type="email"
            autoComplete="email"
            {...register('email')}
            aria-invalid={!!errors.email}
            aria-describedby="email-error"
          />
        </label>
        {errors.email && (
          <p id="email-error" role="alert">
            {errors.email.message}
          </p>
        )}
        {mode !== 'reset' && (
          <>
            <label className="block">
              Пароль
              <input
                className="field"
                type="password"
                autoComplete={
                  mode === 'register' ? 'new-password' : 'current-password'
                }
                {...register('password')}
                aria-invalid={!!errors.password}
                aria-describedby="password-error"
              />
            </label>
            {errors.password && (
              <p id="password-error" role="alert">
                {errors.password.message}
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {notice && mode === 'register' && (
          <Button
            type="button"
            variant="outline"
            disabled={busy || !online}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                const result = await client.auth.resend({
                  type: 'signup',
                  email: getValues('email'),
                  options: { emailRedirectTo: authRedirect('/auth/callback') },
                })
                if (result.error) throw result.error
                setNotice(
                  'Если подтверждение требуется, письмо отправлено. Проверьте почту.',
                )
              } catch (e) {
                setError(errorMessage(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            Отправить подтверждение ещё раз
          </Button>
        )}
        <Button className="w-full" disabled={busy || !online}>
          {busy
            ? 'Подождите…'
            : mode === 'login'
              ? 'Войти'
              : mode === 'register'
                ? 'Зарегистрироваться'
                : 'Отправить письмо'}
        </Button>
      </form>
      <div className="mt-5 flex flex-wrap gap-4 text-sm text-primary">
        <Link to="/auth/login">Вход</Link>
        <Link to="/auth/register">Регистрация</Link>
        <Link to="/auth/reset">Забыли пароль?</Link>
      </div>
    </Card>
  )
}
export function CallbackScreen() {
  const { loading, session, error, retry } = useAuth()
  const params = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.slice(1))
  if (loading) return <LoadingState />
  if (error || params.has('error') || hash.has('error'))
    return (
      <Card>
        <p role="alert">
          Ссылка недействительна или истекла. Запросите новое письмо или
          попробуйте войти.
        </p>
        <Button onClick={retry}>Повторить</Button>
        <Link to="/auth/reset" className="block text-primary">
          Восстановить пароль
        </Link>
        <Link to="/auth/login" className="block text-primary">
          Войти
        </Link>
      </Card>
    )
  if (session) return <Navigate to={authDestination()} replace />
  return (
    <Card>
      <p>
        Подтверждение завершено. Войдите в аккаунт. Если ссылка открыта в другом
        браузере, вернитесь в браузер, в котором запросили письмо.
      </p>
      <Link to="/auth/login" className="text-primary">
        Войти
      </Link>
    </Card>
  )
}
const passwordSchema = z
  .object({
    password: z.string().min(8, 'Минимум 8 символов'),
    confirmation: z.string(),
  })
  .refine((v) => v.password === v.confirmation, {
    path: ['confirmation'],
    message: 'Пароли не совпадают',
  })
export function UpdatePasswordScreen() {
  const { client, session, loading, online } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
  })
  if (loading) return <LoadingState />
  if (!session)
    return (
      <Card>
        <p>Откройте действующую ссылку из письма в том же браузере.</p>
        <Link to="/auth/reset" className="text-primary">
          Запросить новую ссылку
        </Link>
      </Card>
    )
  return (
    <Card>
      <h2 className="text-xl font-semibold">Новый пароль</h2>
      {done ? (
        <>
          <p role="status">Пароль обновлён.</p>
          <Link to={authDestination()} className="text-primary">
            Продолжить
          </Link>
        </>
      ) : (
        <form
          className="mt-4 space-y-4"
          onSubmit={handleSubmit(async ({ password }) => {
            setError(null)
            try {
              if (!online) throw new Error('offline')
              const result = await client!.auth.updateUser({ password })
              if (result.error) throw result.error
              setDone(true)
            } catch (e) {
              setError(errorMessage(e))
            }
          })}
        >
          <label className="block">
            Новый пароль
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              {...register('password')}
            />
          </label>
          {errors.password && <p role="alert">{errors.password.message}</p>}
          <label className="block">
            Повторите пароль
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              {...register('confirmation')}
            />
          </label>
          {errors.confirmation && (
            <p role="alert">{errors.confirmation.message}</p>
          )}
          {error && <p role="alert">{error}</p>}
          <Button disabled={isSubmitting || !online}>Сохранить пароль</Button>
        </form>
      )}
    </Card>
  )
}
