import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuth } from '../auth/auth-context'
import { Button } from '../../components/ui/button'
import {
  ritualSchema,
  defaultTerms,
  emojis,
  presets,
  weekdays,
  type RitualTerms,
  type RitualCardData,
} from './model'
import { useRitualAction } from './api'
import { useRitualIntent } from './intents'
import { RitualRecovery } from './recovery'
import { errorMessage } from '../../lib/errors'
export function RitualForm({
  space,
  expected,
  ritual,
  refresh,
  close,
}: {
  space: string
  expected: number
  ritual?: RitualCardData
  refresh: () => Promise<unknown>
  close: () => void
}) {
  const { session, online } = useAuth(),
    action = useRitualAction(expected)
  const intent = useRitualIntent(
    session!.user.id,
    ritual ? `change:${ritual.id}` : `create:${space}`,
  )
  const {
    register,
    handleSubmit,
    control,
    setValue,
    reset,
    formState: { errors },
  } = useForm<RitualTerms>({
    resolver: zodResolver(ritualSchema),
    defaultValues: ritual?.terms ?? defaultTerms,
  })
  const [cadence, days] = useWatch({ control, name: ['cadence', 'days'] })
  if (intent)
    return action.isPending ? (
      <p role="status">Отправляем предложение…</p>
    ) : (
      <RitualRecovery
        intent={intent}
        refresh={refresh}
        close={close}
        initialError={action.error}
      />
    )
  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((values) => {
        void action
          .mutateAsync(
            ritual
              ? {
                  kind: 'propose',
                  ritual: ritual.id,
                  change: 'edit',
                  payload: values,
                }
              : { kind: 'create', space, values },
          )
          .then(close)
          .catch(() => {})
      })}
    >
      <h3 className="font-semibold">
        {ritual ? 'Предложить новые условия' : 'Предложить ритуал'}
      </h3>
      {!ritual && (
        <fieldset>
          <legend className="mb-2 text-sm">Необязательные идеи</legend>
          <div className="flex flex-wrap gap-2">
            {presets.map(([emoji, title, description]) => (
              <Button
                type="button"
                key={title}
                variant="outline"
                className="h-auto whitespace-normal text-left text-xs"
                onClick={() =>
                  reset({ ...defaultTerms, emoji, title, description })
                }
              >
                {emoji} {title}
              </Button>
            ))}
          </div>
        </fieldset>
      )}
      <p className="text-xs text-muted-foreground">
        Любую идею можно отклонить. Согласие на ритуал не означает согласия на
        физический контакт в конкретный момент. Никаких XP или Coins.
      </p>
      <label className="block text-sm">
        Название
        <input className="field" maxLength={100} {...register('title')} />
      </label>
      <label className="block text-sm">
        Описание
        <textarea
          className="field"
          maxLength={1000}
          {...register('description')}
        />
      </label>
      <label className="block text-sm">
        Иконка
        <select className="field" {...register('emoji')}>
          {emojis.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Расписание
        <select
          className="field"
          {...register('cadence', {
            onChange: (e) =>
              setValue(
                'days',
                e.target.value === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : [1],
              ),
          })}
        >
          <option value="daily">Ежедневно</option>
          <option value="weekdays">По выбранным дням</option>
          <option value="weekly">Раз в неделю</option>
        </select>
      </label>
      {cadence !== 'daily' && (
        <fieldset>
          <legend className="mb-2 text-sm">Дни недели · UTC</legend>
          <div className="flex flex-wrap gap-3">
            {weekdays.map((d, i) => (
              <label key={d} className="flex items-center gap-1 text-sm">
                <input
                  type={cadence === 'weekly' ? 'radio' : 'checkbox'}
                  name="ritual-days"
                  checked={days.includes(i + 1)}
                  onChange={() =>
                    setValue(
                      'days',
                      cadence === 'weekly'
                        ? [i + 1]
                        : days.includes(i + 1)
                          ? days.filter((n) => n !== i + 1)
                          : [...days, i + 1],
                      { shouldValidate: true },
                    )
                  }
                />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <p className="text-xs text-muted-foreground">
        {ritual
          ? 'Принятые изменения вступят в силу со следующего дня UTC. Незавершённый текущий экземпляр остановится, его отметки сохранятся.'
          : 'Ритуал станет активным только после согласия второго участника.'}{' '}
        Пропущенные дни не создаются задним числом.
      </p>
      {Object.values(errors).map((e, i) => (
        <p key={i} role="alert" className="text-sm">
          {e.message}
        </p>
      ))}
      {action.error && <p role="alert">{errorMessage(action.error)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!online || action.isPending}>
          Отправить предложение
        </Button>
        <Button type="button" variant="ghost" onClick={close}>
          Закрыть форму
        </Button>
      </div>
    </form>
  )
}
