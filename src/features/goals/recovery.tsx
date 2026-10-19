import { useIsMutating, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { useAuth } from '../auth/auth-context'
import { errorMessage } from '../../lib/errors'
import { useGoalAction, useGoals } from './api'
import { clearGoalIntent, goalIntentScope, type GoalIntent } from './intents'
import { changeLabels } from './model'
export function GoalRecovery({
  intent,
  close,
  initialError,
}: {
  intent: GoalIntent
  close?: () => void
  initialError?: unknown
}) {
  const { session, online, client } = useAuth()
  const query = useGoals()
  const cache = useQueryClient()
  const action = useGoalAction(query.data)
  const [checking, setChecking] = useState(false),
    [error, setError] = useState<unknown>(null),
    [missing, setMissing] = useState(false)
  const running =
    useIsMutating({ mutationKey: ['goal-action', session?.user.id] }) > 0
  async function inspect() {
    if (!navigator.onLine) return
    setChecking(true)
    setError(null)
    try {
      const result = await client!.rpc('inspect_goal_request', {
        p_request_id: intent.request,
        p_goal_id: intent.action.kind === 'create' ? null : intent.action.goal,
      })
      if (result.error) throw result.error
      if (result.data) {
        clearGoalIntent(
          session!.user.id,
          goalIntentScope(intent.action),
          intent.request,
        )
        await cache.invalidateQueries({ queryKey: ['couple-goals'] })
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
      const result = await query.refetch()
      if (result.error) {
        setError(result.error)
        return
      }
      clearGoalIntent(
        session!.user.id,
        goalIntentScope(intent.action),
        intent.request,
      )
      close?.()
    } catch (e) {
      setError(e)
    } finally {
      setChecking(false)
    }
  }
  return (
    <section
      className="space-y-3 rounded-xl border border-primary/30 bg-muted p-4"
      aria-label="Неизвестный результат запроса"
    >
      <h2 className="font-semibold">Сначала проверьте прежний запрос</h2>
      <p className="text-sm">
        Ответ мог потеряться. Проверка только ищет прежний UUID и ничего не
        создаёт. Исходные условия и счётчик сохранены.
      </p>
      <p className="break-words text-sm">
        {intent.action.kind === 'create'
          ? `Цель: ${intent.action.values.title}`
          : `${changeLabels[intent.action.change]}${intent.action.payload.title ? ': ' + intent.action.payload.title : ''}`}
      </p>
      <Button
        type="button"
        disabled={!online || running || checking}
        onClick={() => void inspect()}
      >
        Проверить прежний запрос
      </Button>
      {missing && (
        <div className="space-y-2">
          <p className="text-sm">
            Запрос пока не найден. Он мог не дойти или ещё выполняться.
            Повторная отправка требует вашего отдельного решения и сохранит
            прежние UUID и условия.
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
            Отправить исходный запрос повторно
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Если данные запроса были утрачены полностью, проверьте список целей и
        историю перед отдельным новым предложением. Сам по себе возврат сети
        ничего не отправляет.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={!online || running || checking}
        onClick={() => void discard()}
      >
        Проверил(а) историю — начать новое действие
      </Button>
      {(action.isError || error !== null || !!initialError) && (
        <p role="alert">
          {errorMessage(error ?? action.error ?? initialError)}
        </p>
      )}
    </section>
  )
}
