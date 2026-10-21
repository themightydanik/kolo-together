import { useState } from 'react'
import { useIsMutating, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import { Button } from '../../components/ui/button'
import { errorMessage } from '../../lib/errors'
import { useRitualAction } from './api'
import {
  clearRitualIntent,
  ritualIntentScope,
  type RitualIntent,
} from './intents'
export function RitualRecovery({
  intent,
  refresh,
  close,
  initialError,
}: {
  intent: RitualIntent
  refresh: () => Promise<unknown>
  close?: () => void
  initialError?: unknown
}) {
  const { client, session, online } = useAuth(),
    cache = useQueryClient(),
    action = useRitualAction(intent.expected)
  const [checking, setChecking] = useState(false),
    [missing, setMissing] = useState(false),
    [error, setError] = useState<unknown>(null)
  const running =
    useIsMutating({ mutationKey: ['ritual-action', session?.user.id] }) > 0
  const clear = () =>
    clearRitualIntent(
      session!.user.id,
      ritualIntentScope(intent.action),
      intent.request,
    )
  async function inspect() {
    setChecking(true)
    try {
      const result = await client!.rpc('inspect_ritual_request', {
        p_request_id: intent.request,
        p_ritual_id:
          intent.action.kind === 'create' ? null : intent.action.ritual,
      })
      if (result.error) throw result.error
      if (result.data) {
        clear()
        await cache.invalidateQueries({ queryKey: ['rituals'] })
        close?.()
      } else setMissing(true)
    } catch (e) {
      setError(e)
    } finally {
      setChecking(false)
    }
  }
  async function discard() {
    setChecking(true)
    try {
      await refresh()
      clear()
      close?.()
    } catch (e) {
      setError(e)
    } finally {
      setChecking(false)
    }
  }
  return (
    <section
      className="space-y-3 rounded-2xl border border-primary/30 bg-muted p-4"
      aria-label="Неизвестный результат ритуала"
    >
      <h3 className="font-semibold">Проверьте прежний запрос</h3>
      <p className="text-sm">
        Ответ мог потеряться. Сохранены исходные UUID, условия и счётчик.
        Проверка только читает результат. Возврат сети не отправляет новое
        предложение.
      </p>
      <Button
        type="button"
        disabled={!online || running || checking}
        onClick={() => void inspect()}
      >
        Проверить прежний запрос
      </Button>
      {missing && (
        <>
          <p className="text-xs">
            Результат пока не найден. Он мог ещё не зафиксироваться.
          </p>
          <Button
            type="button"
            disabled={!online || running || checking}
            onClick={() =>
              void action
                .mutateAsync(intent.action)
                .then(() => close?.())
                .catch(() => {})
            }
          >
            Повторить исходный запрос
          </Button>
        </>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={!online || running || checking}
        onClick={() => void discard()}
      >
        Проверил(а) историю — новое действие
      </Button>
      {error || action.error || initialError ? (
        <p role="alert">
          {errorMessage(error ?? action.error ?? initialError)}
        </p>
      ) : null}
    </section>
  )
}
