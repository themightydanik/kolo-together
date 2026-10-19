import { useState } from 'react'
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
  ArrowUpRight,
  Check,
  CheckCheck,
  Gift,
  Heart,
  House,
  ListTodo,
  Moon,
  Plus,
  Sparkles,
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
  CoupleScreen,
  CreateSpaceScreen,
  InvitePartnerScreen,
} from './features/couple/screens'
import {
  TodayScreen,
  TasksScreen,
  TogetherProgress,
} from './features/tasks/screens'
import { RewardsScreen, DemoRewardStore } from './features/rewards/screens'
import {
  GoalsScreen,
  GoalDetailScreen,
  DemoGoals,
} from './features/goals/screens'
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
function Dashboard({
  tasks,
  toggle,
}: {
  tasks: Task[]
  toggle: (id: string) => void
}) {
  return (
    <div className="space-y-5">
      <Card className="hero relative overflow-hidden border-0 p-6 sm:p-8">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/60 px-3 py-1 text-xs font-semibold text-[#51416b]">
          <Sparkles size={14} /> В своём ритме, вместе
        </span>
        <div className="relative z-10 max-w-sm">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Ближе друг к другу.
            <br />
            Шаг за шагом.
          </h2>
          <p className="mt-3 max-w-64 text-sm leading-relaxed opacity-80">
            Большое «мы» начинается с маленьких забот каждый день.
          </p>
          <Button asChild className="mt-6">
            <NavLink to="/tasks">
              Выбрать доброе дело <ArrowUpRight size={16} />
            </NavLink>
          </Button>
        </div>
        <Heart
          className="absolute -right-5 bottom-5 size-40 rotate-12 text-[#bda5dd]/40 sm:right-8"
          strokeWidth={1}
          aria-hidden="true"
        />
      </Card>
      <div className="grid grid-cols-3 gap-3">
        {[
          ['XP', 'Личный рост'],
          ['Coins', 'Будущие награды'],
          ['Together XP', 'Общий путь'],
        ].map(([title, subtitle]) => (
          <Card key={title} className="p-3 sm:p-4">
            <Sparkles
              className="mb-3 text-primary"
              size={18}
              aria-hidden="true"
            />
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
            <p
              className="mt-3 text-lg font-semibold"
              aria-label="Нет реального баланса"
            >
              —
            </p>
          </Card>
        ))}
      </div>
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Маленькие дела на сегодня</h2>
          <span className="rounded-full bg-muted px-2 py-1 text-xs">
            {tasks.filter((t) => t.done).length}/{tasks.length}
          </span>
        </div>
        <TaskList tasks={tasks} toggle={toggle} />
      </Card>
      <p className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
        <Heart size={15} aria-hidden="true" /> Здесь вы в одной команде
      </p>
    </div>
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
      <Route path="/" element={<Dashboard tasks={tasks} toggle={toggle} />} />
      <Route
        path="/tasks"
        element={
          <Card>
            <h2 className="font-semibold">Забота в простых действиях</h2>
            <TaskList tasks={tasks} toggle={toggle} />
            <TaskForm add={add} />
          </Card>
        }
      />
      <Route path="/goals" element={<DemoGoals />} />
      <Route path="/rewards" element={<DemoRewardStore />} />
      <Route
        path="/us"
        element={
          <Card>
            <div className="mb-5 flex gap-2">
              <span className="avatar">А</span>
              <span className="avatar">Б</span>
            </div>
            <h2 className="text-xl font-semibold">
              Два человека. Одна команда.
            </h2>
            <p className="mt-3 text-muted-foreground">
              У обоих равные права. Поддержка важнее контроля, а общий прогресс
              важнее сравнения.
            </p>
            <div className="mt-6 rounded-2xl bg-muted p-4 text-sm">
              <CheckCheck className="mb-2 text-primary" />
              <p>
                Автоматическое подтверждение дел по умолчанию. Другие правила —
                только по взаимному согласию.
              </p>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Демо-профили · приглашения и авторизация ещё не подключены.
            </p>
          </Card>
        }
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
        <Route path="/tasks" element={<TasksScreen />} />
        <Route path="/goals" element={<GoalsScreen />} />
        <Route path="/goals/:goalId" element={<GoalDetailScreen />} />
        <Route path="/rewards" element={<RewardsScreen />} />
        <Route
          path="/us"
          element={
            <div className="space-y-5">
              <TogetherProgress />
              <CoupleScreen />
            </div>
          }
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
      <div className="mx-auto max-w-3xl px-4 pb-28 pt-6 sm:px-8 sm:pt-10">
        <header className="mb-8 flex items-center justify-between">
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
          <Button
            variant="ghost"
            onClick={changeTheme}
            aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
          >
            {dark ? <Sun size={20} /> : <Moon size={20} />}
          </Button>
        </header>
        <main id="main">
          <div className="mb-5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
              Наше маленькое пространство
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          </div>
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
              Деморежим · изменения хранятся только в памяти. Supabase не
              подключён. Пользовательская сессия не создаётся.
            </aside>
          )}
          {client && session && <LinkToProfile />}
          {client ? <RealWorkspace /> : <DemoWorkspace />}
        </main>
      </div>
      <nav
        aria-label="Основная навигация"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-3xl justify-around px-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
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
    <NavLink to="/profile" className="mb-4 inline-block text-sm text-primary">
      Мой профиль
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
