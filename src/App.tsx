import {ActivityBell, ActivityScreen} from './features/activity/screens'
import { PageHeader, GentleOnboarding } from './components/experience'
import {
  UsOverview,
  UsHistory,
  UsTraditions,
  UsSettings,
  DemoToday,
  DemoGoalsExperience,
  DemoRewardsExperience,
} from './features/experience/screens'
import {
  ConnectionHub,
  ConnectionDetail,
  DemoConnection,
} from './features/connection/screens'
import { useState, useEffect } from 'react'
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Check,
  Gift,
  Heart,
  House,
  ListTodo,
  Moon,
  Plus,
  Sun,
  Target,
  Users,
} from 'lucide-react'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import { EmptyState, ErrorState, LoadingState } from './components/states'
import { loadDemoTasks, type Task } from './features/demo'
import { AuthProvider } from './features/auth/auth-provider'
import { useAuth } from './features/auth/auth-context'
import {
  AuthScreen,
  CallbackScreen,
  ProtectedRoute,
  UpdatePasswordScreen,
} from './features/auth/auth-screens'
import {
  AcceptInvitationScreen,
  CreateSpaceScreen,
  InvitePartnerScreen,
} from './features/couple/screens'
import { TodayScreen, TasksScreen } from './features/tasks/screens'
import { RewardsScreen } from './features/rewards/screens'
import { GoalsScreen, GoalDetailScreen } from './features/goals/screens'
import { ProfileScreen } from './features/profile/profile-screen'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: Infinity } },
})
const navigation = [
  { path: '/', title: 'Сегодня', icon: House },
  { path: '/tasks', title: 'Дела', icon: ListTodo },
  { path: '/goals', title: 'Цели', icon: Target },
  { path: '/rewards', title: 'Награды', icon: Gift },
  { path: '/us', title: 'Мы', icon: Users },
]
const taskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, 'Введите хотя бы 2 символа')
    .max(100, 'Не больше 100 символов'),
})
type TaskInput = z.infer<typeof taskSchema>

function TaskList({
  tasks,
  toggle,
}: {
  tasks: Task[]
  toggle: (id: string) => void
}) {
  if (!tasks.length)
    return (
      <EmptyState
        title="Место для маленьких шагов"
        description="Добавьте первое дело, которое сделает ваш день теплее."
      />
    )
  return (
    <ul className="divide-y divide-border">
      {tasks.map((task) => (
        <li key={task.id}>
          <button
            type="button"
            onClick={() => toggle(task.id)}
            aria-pressed={task.done}
            className="flex min-h-16 w-full items-center gap-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-lg border ${task.done ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}
            >
              {task.done && <Check size={16} aria-hidden="true" />}
            </span>
            <span
              className={task.done ? 'text-muted-foreground line-through' : ''}
            >
              {task.title}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
function TaskForm({ add }: { add: (title: string) => void }) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TaskInput>({ resolver: zodResolver(taskSchema) })
  return (
    <form
      onSubmit={handleSubmit(({ title }) => {
        add(title)
        reset()
      })}
      className="mt-5 space-y-2"
    >
      <label htmlFor="task-title" className="text-sm font-semibold">
        Новое дело
      </label>
      <div className="flex gap-2">
        <input
          id="task-title"
          {...register('title')}
          aria-invalid={!!errors.title}
          aria-describedby={errors.title ? 'title-error' : undefined}
          placeholder="Что сделаем вместе?"
          className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 outline-ring"
        />
        <Button type="submit" aria-label="Добавить дело">
          <Plus size={20} />
        </Button>
      </div>
      {errors.title && (
        <p id="title-error" role="alert" className="text-sm text-destructive">
          {errors.title.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Только в этой сессии · без начисления XP и Coins
      </p>
    </form>
  )
}
function DemoWorkspace() {
  const query = useQuery({ queryKey: ['demo-tasks'], queryFn: loadDemoTasks })
  const tasks = query.data ?? []
  const toggle = (id: string) =>
    queryClient.setQueryData<Task[]>(['demo-tasks'], (old) =>
      old?.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    )
  const add = (title: string) =>
    queryClient.setQueryData<Task[]>(['demo-tasks'], (old) => [
      ...(old ?? []),
      { id: crypto.randomUUID(), title, done: false },
    ])
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return (
      <ErrorState
        retry={() => {
          void query.refetch()
        }}
      />
    )
  return (
    <Routes>
      <Route path="/" element={<DemoToday />} />
      <Route path="/activity" element={<ActivityScreen />} />
      <Route
        path="/tasks"
        element={
          <div className="space-y-5">
            <PageHeader title="Дела" description="Забота в простых действиях" />
            <GentleOnboarding
              id="demo-tasks"
              title="Попробуйте одно небольшое дело"
            >
              Эти примеры меняются только на этом устройстве до перезагрузки.
            </GentleOnboarding>
            <Card>
              <TaskList tasks={tasks} toggle={toggle} />
              <details className="quiet-details">
                <summary>Добавить своё дело</summary>
                <TaskForm add={add} />
              </details>
            </Card>
          </div>
        }
      />
      <Route path="/goals" element={<DemoGoalsExperience />} />
      <Route path="/rewards" element={<DemoRewardsExperience />} />
      <Route path="/us" element={<UsOverview />} />
      <Route path="/us/history" element={<UsHistory />} />
      <Route path="/us/traditions" element={<UsTraditions />} />
      <Route path="/us/settings" element={<UsSettings />} />
      <Route path="/us/connection/game" element={<DemoConnection />} />
      <Route
        path="/us/connection/mood"
        element={<ConnectionHub mode="mood" />}
      />
      <Route
        path="/us/connection/questionnaires"
        element={<ConnectionHub mode="questionnaires" />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
function RealWorkspace() {
  return (
    <Routes>
      <Route path="/auth/login" element={<AuthScreen mode="login" />} />
      <Route path="/auth/register" element={<AuthScreen mode="register" />} />
      <Route path="/auth/reset" element={<AuthScreen mode="reset" />} />
      <Route path="/auth/callback" element={<CallbackScreen />} />
      <Route path="/auth/update-password" element={<UpdatePasswordScreen />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<TodayScreen />} />
        <Route path="/activity" element={<ActivityScreen />} />
        <Route path="/tasks" element={<TasksScreen />} />
        <Route path="/goals" element={<GoalsScreen />} />
        <Route path="/goals/:goalId" element={<GoalDetailScreen />} />
        <Route path="/rewards" element={<RewardsScreen />} />
        <Route path="/us" element={<UsOverview />} />
        <Route path="/us/history" element={<UsHistory />} />
        <Route path="/us/traditions" element={<UsTraditions />} />
        <Route path="/us/settings" element={<UsSettings />} />
        <Route
          path="/us/connection/mood"
          element={<ConnectionHub mode="mood" />}
        />
        <Route
          path="/us/connection/questionnaires"
          element={<ConnectionHub mode="questionnaires" />}
        />
        <Route
          path="/us/connection/game"
          element={<ConnectionHub mode="game" />}
        />
        <Route
          path="/us/connection/session/:connectionId"
          element={<ConnectionDetail />}
        />
        <Route path="/profile" element={<ProfileScreen />} />
        <Route path="/space/create" element={<CreateSpaceScreen />} />
        <Route path="/space/invite" element={<InvitePartnerScreen />} />
        <Route path="/invite" element={<AcceptInvitationScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
function initialTheme(): boolean {
  try {
    const saved = localStorage.getItem('kolo-theme')
    return saved
      ? saved === 'dark'
      : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  } catch {
    return false
  }
}
function Shell() {
  const { client, session, online } = useAuth()
  const [dark, setDark] = useState(initialTheme)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    return () => document.documentElement.classList.remove('dark')
  }, [dark])
  const location = useLocation()
  const extraTitles: Record<string, string> = {
    '/auth/login': 'Вход',
    '/auth/register': 'Регистрация',
    '/auth/reset': 'Восстановление пароля',
    '/auth/update-password': 'Новый пароль',
    '/auth/callback': 'Подтверждение email',
    '/profile': 'Профиль',
    '/space/create': 'Пространство',
    '/space/invite': 'Приглашение партнёра',
    '/invite': 'Приглашение',
  }
  const title =
    navigation.find((item) => item.path === location.pathname)?.title ??
    (location.pathname.startsWith('/goals/') ? 'Ваша цель' : undefined) ??
    extraTitles[location.pathname] ??
    'Сегодня'
  function changeTheme() {
    setDark(!dark)
    try {
      localStorage.setItem('kolo-theme', dark ? 'light' : 'dark')
    } catch {
      /* Theme still works without storage. */
    }
  }
  return (
    <div
      className={`${dark ? 'dark' : ''} min-h-dvh bg-background text-foreground`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-card focus:p-4"
      >
        К содержимому
      </a>
      <div className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-8 sm:pt-10">
        <header className="mb-7 flex items-center justify-between">
          <NavLink
            to="/"
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Heart size={21} aria-hidden="true" />
            </span>
            KOLO{' '}
            <span className="font-normal text-muted-foreground">Together</span>
          </NavLink>
          <div className="flex items-center gap-1">
            <ActivityBell />
            {client && session && <LinkToProfile />}
            <Button
              variant="ghost"
              onClick={changeTheme}
              aria-label={
                dark ? 'Включить светлую тему' : 'Включить тёмную тему'
              }
            >
              {dark ? <Sun size={20} /> : <Moon size={20} />}
            </Button>
          </div>
        </header>
        <main id="main">
          {location.pathname !== '/' &&
            !['/tasks', '/goals', '/rewards', '/us', '/activity'].includes(
              location.pathname,
            ) &&
            !location.pathname.startsWith('/us/') && (
              <PageHeader title={title} />
            )}
          {!online && (
            <p
              role="status"
              className="mb-4 rounded-xl border border-border p-3 text-sm"
            >
              Нет сети. Подключитесь к интернету, чтобы сохранять изменения.
            </p>
          )}
          {!client && (
            <aside className="mb-5 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
              Демо · знакомство с KOLO Together.{' '}
              <details className="inline">
                <summary className="inline min-h-0 p-0 underline">
                  Что это значит?
                </summary>
                <p>
                  Здесь нет аккаунтов и покупок. Изменения примеров дел остаются
                  только в памяти этой страницы.
                </p>
              </details>
            </aside>
          )}

          {client ? <RealWorkspace /> : <DemoWorkspace />}
        </main>
      </div>
      <nav
        aria-label="Основная навигация"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-5xl justify-around px-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
          {navigation.map(({ path, title, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              className={({ isActive }) =>
                `flex min-h-14 min-w-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-ring ${isActive ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted'}`
              }
            >
              <Icon size={21} aria-hidden="true" />
              {title}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
function LinkToProfile() {
  return (
    <NavLink
      to="/profile"
      aria-label="Мой профиль"
      className="icon-button flex items-center justify-center rounded-xl text-primary"
    >
      <Users size={20} aria-hidden="true" />
    </NavLink>
  )
}
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
