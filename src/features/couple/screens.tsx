import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Heart, Users } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { clearInvitationToken, invitationToken } from '../auth/invitation-token'
import { useCouple } from './api'

import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { EmptyState, LoadingState } from '../../components/states'
import { errorMessage } from '../../lib/errors'

function QueryError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <Card>
      <p role="alert">{errorMessage(error)}</p>
      <Button onClick={retry}>Повторить</Button>
    </Card>
  )
}
export function CoupleStatus() {
  const query = useCouple()
  const { session } = useAuth()
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return (
      <QueryError
        error={query.error}
        retry={() => {
          void query.refetch()
        }}
      />
    )
  if (!query.data)
    return (
      <Card>
        <Users className="mb-3 text-primary" aria-hidden="true" />
        <h2 className="font-semibold">Ваше пространство начинается здесь</h2>
        <p className="my-3 text-sm text-muted-foreground">
          Создайте пространство для себя, а партнёра пригласите, когда будете
          готовы.
        </p>
        <Button asChild>
          <Link to="/space/create">Создать пространство</Link>
        </Button>
      </Card>
    )
  const partner = query.data.profiles.find((p) => p.id !== session?.user.id)
  return (
    <Card>
      <Heart className="mb-3 text-primary" aria-hidden="true" />
      <h2 className="font-semibold">
        {partner
          ? `Вместе с ${partner.display_name || 'партнёром'}`
          : 'Ваше пространство готово'}
      </h2>
      <p className="my-3 text-sm text-muted-foreground">
        {partner
          ? 'Вы равноправные участники. Каждый может выйти из пространства самостоятельно.'
          : 'Партнёр пока не подключён. Вы можете пользоваться своим пространством; совместные функции ждут второго участника.'}
      </p>
      {!partner && (
        <Button asChild>
          <Link to="/space/invite">Пригласить партнёра</Link>
        </Button>
      )}
    </Card>
  )
}
export function CreateSpaceScreen() {
  const { client, online } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const query = useCouple()
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await client!.rpc('create_couple_space')
      if (error) throw error
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['couple'] })
      await queryClient.invalidateQueries({ queryKey: ['task-workspace'] })
      await queryClient.invalidateQueries({ queryKey: ['reward-store'] })
      await queryClient.invalidateQueries({ queryKey: ['couple-goals'] })
      queryClient.removeQueries({ queryKey: ['rituals'] })
      queryClient.removeQueries({ queryKey: ['ritual-history'] })
      queryClient.removeQueries({ queryKey: ['ritual-summary'] })
      queryClient.removeQueries({ queryKey: ['statistics'] })
      queryClient.removeQueries({ queryKey: ['joint-history'] })
      queryClient.removeQueries({ queryKey: ['connection'] })
      queryClient.removeQueries({ queryKey: ['connection-pages'] })
      queryClient.removeQueries({ queryKey: ['activity'] })
      queryClient.removeQueries({ queryKey: ['activity-pages'] })
      navigate('/us', { replace: true })
    },
  })
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return (
      <QueryError
        error={query.error}
        retry={() => {
          void query.refetch()
        }}
      />
    )
  if (query.data) return <Navigate to="/us" replace />
  return (
    <Card>
      <h2 className="text-xl font-semibold">Место для вашего «мы»</h2>
      <p className="my-4 text-muted-foreground">
        Начните самостоятельно. Это не создаёт заданий, подписок и финансовых
        обязательств. Позже вы сможете пригласить одного партнёра.
      </p>
      {create.isError && <p role="alert">{errorMessage(create.error)}</p>}
      <Button
        disabled={create.isPending || !online}
        onClick={() => create.mutate()}
      >
        {create.isPending ? 'Создаём…' : 'Создать пространство'}
      </Button>
    </Card>
  )
}
const emailSchema = z.object({
  email: z.string().trim().email('Введите корректный email').max(254),
})
export function InvitePartnerScreen() {
  const { client, online } = useAuth()
  const queryClient = useQueryClient()
  const query = useCouple()
  const [link, setLink] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
  })
  const create = useMutation({
    mutationFn: async (email: string) => {
      setLink(null)
      const { data, error } = await client!.rpc('create_couple_invitation', {
        p_email: email,
      })
      if (error) throw error
      return data
    },
    onSuccess: (token) => {
      setLink(`${window.location.origin}/invite#token=${token}`)
      void queryClient.invalidateQueries({ queryKey: ['couple'] })
    },
  })
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return (
      <QueryError
        error={query.error}
        retry={() => {
          void query.refetch()
        }}
      />
    )
  if (!query.data) return <Navigate to="/space/create" replace />
  if (query.data.members.length >= 2)
    return (
      <Card>
        <p>Вы уже вдвоём. Третий участник не может присоединиться.</p>
        <Link to="/us">Вернуться к паре</Link>
      </Card>
    )
  return (
    <Card>
      <h2 className="text-xl font-semibold">Пригласить партнёра</h2>
      <p className="my-3 text-sm text-muted-foreground">
        Ссылка действует 24 часа и только для указанного подтверждённого email.
        Новая ссылка отменяет предыдущую. Отправьте её партнёру лично — письмо
        автоматически не отправляется.
      </p>
      <form
        className="space-y-4"
        onSubmit={handleSubmit(({ email }) => create.mutate(email))}
      >
        <label className="block">
          Email партнёра
          <input
            className="field"
            type="email"
            autoComplete="off"
            {...register('email')}
          />
        </label>
        {errors.email && <p role="alert">{errors.email.message}</p>}
        {create.isError && <p role="alert">{errorMessage(create.error)}</p>}
        <Button disabled={create.isPending || !online}>
          {create.isPending ? 'Создаём…' : 'Создать приглашение'}
        </Button>
      </form>
      {link && (
        <div className="mt-5 space-y-2">
          <label htmlFor="invite-link" className="block text-sm">
            Сохраните ссылку сейчас: после ухода с экрана её нельзя
            восстановить.
          </label>
          <input
            id="invite-link"
            className="field"
            readOnly
            value={link}
            onFocus={(e) => e.target.select()}
          />
          <p className="text-xs text-muted-foreground">
            Не публикуйте ссылку в открытом доступе.
          </p>
        </div>
      )}
      <ul className="mt-5 space-y-2 text-sm">
        {query.data.invitations.map((i) => (
          <li key={i.id}>
            {i.recipient_email}:{' '}
            {i.consumed_at
              ? 'принято'
              : i.declined_at
                ? 'отклонено'
                : i.revoked_at
                  ? 'отменено'
                  : new Date(i.expires_at).getTime() <= now
                    ? 'истекло'
                    : 'ожидает ответа'}
          </li>
        ))}
      </ul>
    </Card>
  )
}
export function AcceptInvitationScreen() {
  const { client, session, online } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const token = invitationToken()
  const preview = useQuery({
    queryKey: ['invitation', session?.user.id],
    queryFn: async () => {
      const { data, error } = await client!.rpc('inspect_couple_invitation', {
        p_token: token!,
      })
      if (error) throw error
      return data
    },
    enabled: !!token,
    staleTime: 0,
    retry: false,
  })
  const resolve = useMutation({
    mutationFn: async (accept: boolean) => {
      const { error } = await client!.rpc('resolve_couple_invitation', {
        p_token: token!,
        p_accept: accept,
      })
      if (error) throw error
      return accept
    },
    onSuccess: async (accept) => {
      clearInvitationToken()
      queryClient.removeQueries({ queryKey: ['invitation'] })
      await queryClient.invalidateQueries({ queryKey: ['couple'] })
      await queryClient.invalidateQueries({ queryKey: ['task-workspace'] })
      await queryClient.invalidateQueries({ queryKey: ['reward-store'] })
      await queryClient.invalidateQueries({ queryKey: ['couple-goals'] })
      queryClient.removeQueries({ queryKey: ['rituals'] })
      queryClient.removeQueries({ queryKey: ['ritual-history'] })
      queryClient.removeQueries({ queryKey: ['ritual-summary'] })
      queryClient.removeQueries({ queryKey: ['statistics'] })
      queryClient.removeQueries({ queryKey: ['joint-history'] })
      queryClient.removeQueries({ queryKey: ['connection'] })
      queryClient.removeQueries({ queryKey: ['connection-pages'] })
      queryClient.removeQueries({ queryKey: ['activity'] })
      queryClient.removeQueries({ queryKey: ['activity-pages'] })
      navigate(accept ? '/us' : '/', {
        replace: true,
        state: { invitationDeclined: !accept },
      })
    },
  })
  if (!token)
    return (
      <Card>
        <p>
          Откройте ссылку приглашения от партнёра. Для сохранения ссылки во
          время входа разрешите sessionStorage в браузере.
        </p>
        <Link to="/us" className="text-primary">
          В своё пространство
        </Link>
      </Card>
    )
  if (preview.isPending) return <LoadingState />
  if (preview.isError)
    return (
      <QueryError
        error={preview.error}
        retry={() => {
          void preview.refetch()
        }}
      />
    )
  if (!preview.data?.length)
    return (
      <Card>
        <p role="alert">
          Приглашение недоступно: оно истекло, использовано, отменено или
          предназначено для другого email. Вы вошли как {session?.user.email}.
        </p>
        <Link to="/profile" className="text-primary">
          Сменить аккаунт
        </Link>
      </Card>
    )
  return (
    <Card>
      <h2 className="text-xl font-semibold">Вас приглашают в KOLO</h2>
      <p className="my-4 text-muted-foreground">
        Вы станете равноправными партнёрами. Приглашение не создаёт заданий или
        финансовых обязательств. Если у вас уже есть пространство, сначала
        выйдите из него в разделе «Мы».
      </p>
      <p className="mb-4 text-sm">
        Действует до{' '}
        {new Date(preview.data[0].expires_at).toLocaleString('ru-RU')}
      </p>
      {resolve.isError && <p role="alert">{errorMessage(resolve.error)}</p>}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={resolve.isPending || !online}
          onClick={() => resolve.mutate(true)}
        >
          Принять приглашение
        </Button>
        <Button
          variant="outline"
          disabled={resolve.isPending || !online}
          onClick={() => resolve.mutate(false)}
        >
          Отклонить
        </Button>
      </div>
    </Card>
  )
}
export function CoupleScreen() {
  const { client, online } = useAuth()
  const query = useCouple()
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const leave = useMutation({
    mutationFn: async () => {
      const { error } = await client!.rpc('leave_couple_space')
      if (error) throw error
    },
    onSuccess: async () => {
      setConfirm(false)
      queryClient.removeQueries({ queryKey: ['invitation'] })
      await queryClient.invalidateQueries({ queryKey: ['couple'] })
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      await queryClient.invalidateQueries({ queryKey: ['task-workspace'] })
      await queryClient.invalidateQueries({ queryKey: ['reward-store'] })
      await queryClient.invalidateQueries({ queryKey: ['couple-goals'] })
      queryClient.removeQueries({ queryKey: ['rituals'] })
      queryClient.removeQueries({ queryKey: ['ritual-history'] })
      queryClient.removeQueries({ queryKey: ['ritual-summary'] })
      queryClient.removeQueries({ queryKey: ['statistics'] })
      queryClient.removeQueries({ queryKey: ['joint-history'] })
      queryClient.removeQueries({ queryKey: ['connection'] })
      queryClient.removeQueries({ queryKey: ['connection-pages'] })
      queryClient.removeQueries({ queryKey: ['activity'] })
      queryClient.removeQueries({ queryKey: ['activity-pages'] })
    },
  })
  return (
    <div className="space-y-5">
      <CoupleStatus />
      <Card>
        <h2 className="font-semibold">Два человека. Одна команда.</h2>
        <p className="my-3 text-sm text-muted-foreground">
          Равные права. Своё выполнение каждый подтверждает самостоятельно. Нет
          штрафов, обязательств и рейтинга партнёров.
        </p>
        <Button asChild variant="outline">
          <Link to="/profile">Мой профиль</Link>
        </Button>
        {!!query.data && (
          <div className="mt-5">
            {confirm ? (
              <>
                <p className="mb-3 text-sm">
                  Вы потеряете доступ к этому пространству и профилю партнёра.
                  Приглашения и незавершённые общие дела будут закрыты.
                  Заработанные XP и Coins сохранятся. Продолжить?
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={leave.isPending || !online}
                    onClick={() => leave.mutate()}
                  >
                    Подтвердить выход
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={leave.isPending}
                    onClick={() => setConfirm(false)}
                  >
                    Отмена
                  </Button>
                </div>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirm(true)}>
                Выйти из пространства
              </Button>
            )}
            {leave.isError && <p role="alert">{errorMessage(leave.error)}</p>}
          </div>
        )}
      </Card>
    </div>
  )
}
export function PersonalHome() {
  return (
    <div className="space-y-5">
      <Card className="hero">
        <h2 className="text-3xl font-semibold">
          Ближе друг к другу.
          <br />
          Шаг за шагом.
        </h2>
        <p className="mt-3 text-sm">
          Ваше пространство заботы — в своём ритме.
        </p>
      </Card>
      <CoupleStatus />
    </div>
  )
}
export function FutureSection({ title }: { title: string }) {
  return (
    <div className="space-y-5">
      <CoupleStatus />
      <Card>
        <EmptyState
          title={title}
          description="Этот раздел появится на следующем этапе. Реальные данные, начисления и финансовые операции здесь не создаются."
        />
      </Card>
    </div>
  )
}
