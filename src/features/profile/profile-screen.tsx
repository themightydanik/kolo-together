import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../auth/auth-context'
import { clearInvitationToken } from '../auth/invitation-token'
import { errorMessage } from '../../lib/errors'
import type { Profile } from '../../lib/database.types'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { LoadingState } from '../../components/states'
const schema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, 'Введите имя')
    .max(80, 'Не больше 80 символов'),
  avatar_url: z.union([
    z.literal(''),
    z
      .string()
      .url('Введите URL')
      .startsWith('https://', 'Только HTTPS')
      .max(2048),
  ]),
})
function ProfileForm({ profile }: { profile: Profile }) {
  const { client, online } = useAuth()
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      display_name: profile.display_name,
      avatar_url: profile.avatar_url ?? '',
    },
  })
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      setSaved(false)
      const { data, error } = await client!
        .from('profiles')
        .update({ ...values, avatar_url: values.avatar_url || null })
        .eq('id', profile.id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
      void queryClient.invalidateQueries({ queryKey: ['couple'] })
    },
  })
  return (
    <form
      className="mt-5 space-y-4"
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
    >
      <label className="block">
        Ваше имя
        <input
          className="field"
          autoComplete="nickname"
          {...register('display_name')}
        />
      </label>
      {errors.display_name && <p role="alert">{errors.display_name.message}</p>}
      <label className="block">
        Ссылка на аватар (необязательно)
        <input className="field" type="url" {...register('avatar_url')} />
      </label>
      {errors.avatar_url && <p role="alert">{errors.avatar_url.message}</p>}
      <p className="text-xs text-muted-foreground">
        Только HTTPS. Загрузка файлов пока не поддерживается; ссылка сохраняется
        в профиле. Внешние изображения автоматически не загружаются.
      </p>
      {mutation.isError && <p role="alert">{errorMessage(mutation.error)}</p>}
      {saved && <p role="status">Профиль сохранён.</p>}
      <Button disabled={mutation.isPending || !online}>
        {mutation.isPending ? 'Сохраняем…' : 'Сохранить профиль'}
      </Button>
    </form>
  )
}
export function ProfileScreen() {
  const { client, session, online } = useAuth()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['profile', session?.user.id],
    queryFn: async () => {
      const { data, error } = await client!
        .from('profiles')
        .select('*')
        .eq('id', session!.user.id)
        .single()
      if (error) throw error
      return data
    },
  })
  const logout = useMutation({
    mutationFn: async () => {
      const { error } = await client!.auth.signOut({ scope: 'local' })
      if (error) throw error
    },
    onSuccess: () => {
      clearInvitationToken()
      queryClient.clear()
    },
  })
  if (query.isPending) return <LoadingState />
  return (
    <Card>
      <h2 className="text-xl font-semibold">Мой профиль</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {session?.user.email}
      </p>
      {query.isError ? (
        <>
          <p role="alert">{errorMessage(query.error)}</p>
          <Button
            onClick={() => {
              void query.refetch()
            }}
          >
            Повторить
          </Button>
        </>
      ) : (
        <ProfileForm key={query.data.id} profile={query.data} />
      )}
      <div className="mt-6 border-t border-border pt-4">
        {logout.isError && <p role="alert">{errorMessage(logout.error)}</p>}
        <Button
          variant="outline"
          disabled={logout.isPending || !online}
          onClick={() => logout.mutate()}
        >
          {logout.isPending ? 'Выходим…' : 'Выйти из аккаунта'}
        </Button>
      </div>
    </Card>
  )
}
