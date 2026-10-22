import {
  PageHeader,
  OverflowMenu,
  ConfirmationDialog,
} from '../../components/experience'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Coins, Gift } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { EmptyState, LoadingState } from '../../components/states'
import { errorMessage } from '../../lib/errors'
import type { RewardOffer, RewardPurchase } from '../../lib/database.types'
import { useRewardStore, useRewardAction, type RewardStore } from './api'
import { RewardForm } from './form'
import { rewardCategories } from './model'
import {
  purchaseIntent,
  clearPurchaseRequest,
  pendingPurchaseRequest,
} from './purchase-request'
const statuses = {
  pending: 'Ожидает исполнения',
  ready: 'Готовность подтверждена · ждёт подтверждения покупателем',
  completed: 'Выполнено',
  cancelled: 'Отменено · Coins возвращены',
}
const offerStatuses = {
  pending: 'Ожидает согласия',
  active: 'В магазине',
  paused: 'Снята с публикации',
  declined: 'Отклонена',
  closed: 'Закрыта после выхода',
}
function person(data: RewardStore, id: string, me: string) {
  return id === me
    ? 'Вы'
    : data.couple?.profiles.find((p) => p.id === id)?.display_name || 'Партнёр'
}
export function RewardOfferCard({
  offer,
  data,
}: {
  offer: RewardOffer
  data: RewardStore
}) {
  const { session, online } = useAuth()
  const me = session!.user.id
  const action = useRewardAction()
  const [confirm, setConfirm] = useState(false)
  const [receipt, setReceipt] = useState(false)
  const sold =
    offer.single_use && data.purchases.some((p) => p.offer_id === offer.id)
  const recovering = !!pendingPurchaseRequest(me, offer.id)
  const canBuy =
    recovering ||
    (offer.status === 'active' &&
      !sold &&
      (offer.kind === 'joint' || offer.creator_id !== me))
  const enough = data.summary.balance >= offer.price
  const pending = offer.status === 'pending' && offer.partner_id === me
  const ownPurchases = data.purchases.filter(
    (p) => p.offer_id === offer.id && p.buyer_id === me,
  )
  function buy() {
    action.mutate(
      {
        kind: 'buy',
        id: offer.id,
        ...purchaseIntent(me, offer.id, ownPurchases.length),
      },
      {
        onError: (error) => {
          if (
            error &&
            typeof error === 'object' &&
            'message' in error &&
            error.message === 'reward_purchase_changed'
          ) {
            clearPurchaseRequest(me, offer.id)
            setConfirm(false)
          }
        },
        onSuccess: () => {
          clearPurchaseRequest(me, offer.id)
          setConfirm(false)
          setReceipt(true)
        },
      },
    )
  }
  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-3xl" aria-hidden="true">
          {offer.emoji}
        </span>
        <div className="min-w-0">
          <h2 className="break-words font-semibold">{offer.title}</h2>
          <p className="text-xs text-muted-foreground">
            {rewardCategories[offer.category]} ·{' '}
            {offer.kind === 'joint' ? 'Совместная' : 'От партнёра'} ·{' '}
            {offer.single_use ? 'Однократная' : 'Многократная'}
          </p>
        </div>
      </div>
      {offer.description && (
        <p className="whitespace-pre-wrap break-words text-sm">
          {offer.description}
        </p>
      )}
      <details className="quiet-details">
        <summary>Условия награды</summary>
        <p className="text-sm">
          {offer.kind === 'joint'
            ? 'Участвуют оба. Покупатель платит свои Coins и подтверждает получение; партнёр подтверждает готовность или отказывается с возвратом.'
            : 'Предоставляет: ' + person(data, offer.creator_id, me)}
        </p>
        <p className="text-sm">
          {offer.single_use
            ? 'Можно выбрать один раз'
            : 'Можно выбирать повторно'}
        </p>
      </details>
      <p className="font-semibold text-primary">{offer.price} Coins</p>
      <p className="text-xs text-muted-foreground">
        {sold ? 'Уже приобретена — однократная' : offerStatuses[offer.status]}
      </p>
      {pending && (
        <div className="space-y-2">
          <p className="text-sm">
            Согласны добавить эту совместную награду? Это не обязательство
            исполнить её по требованию.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!online || action.isPending}
              onClick={() => action.mutate({ kind: 'accept', id: offer.id })}
            >
              Принять предложение
            </Button>
            <Button
              variant="outline"
              disabled={!online || action.isPending}
              onClick={() => action.mutate({ kind: 'decline', id: offer.id })}
            >
              Отклонить
            </Button>
          </div>
        </div>
      )}
      {canBuy && !confirm && (
        <Button
          disabled={!online || action.isPending || (!enough && !recovering)}
          onClick={() => {
            setConfirm(true)
            setReceipt(false)
          }}
        >
          {recovering
            ? 'Проверить предыдущую покупку'
            : `${ownPurchases.length ? 'Купить ещё за' : 'Получить за'} ${offer.price} Coins`}
        </Button>
      )}
      {canBuy && !enough && !recovering && (
        <p className="text-sm text-muted-foreground">
          Недостаточно Coins. Заработайте ещё{' '}
          {offer.price - data.summary.balance} за дела.
        </p>
      )}
      {canBuy && confirm && (
        <div
          className="space-y-3 rounded-xl bg-muted p-3"
          role="group"
          aria-label="Подтверждение покупки"
        >
          <p className="text-sm">
            {recovering &&
              'Повторим прежний запрос, чтобы проверить его результат. Это не новая покупка. '}
            {!recovering &&
              ownPurchases.length > 0 &&
              'У вас уже есть покупка этой награды. Проверьте «Историю», если ответ потерялся. Это отдельная новая покупка с новым списанием. '}
            Спишется {offer.price} ваших Coins. Договоритесь об исполнении:
            можно отказаться или отменить покупку с полным возвратом.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!online || action.isPending || (!enough && !recovering)}
              onClick={buy}
            >
              {action.isPending
                ? 'Проверяем…'
                : recovering
                  ? 'Повторить безопасно'
                  : `Подтвердить за ${offer.price} Coins`}
            </Button>
            <Button
              variant="ghost"
              disabled={action.isPending}
              onClick={() => setConfirm(false)}
            >
              Пока не покупать
            </Button>
          </div>
        </div>
      )}
      {receipt && (
        <p role="status" className="text-sm">
          Награда выбрана. Откройте «История», чтобы договориться об исполнении.
        </p>
      )}
      {offer.creator_id === me &&
        ['active', 'paused'].includes(offer.status) && (
          <OverflowMenu label={'Действия: ' + offer.title}>
            <Button
              variant="outline"
              disabled={!online || action.isPending}
              onClick={() =>
                action.mutate({
                  kind: offer.status === 'active' ? 'pause' : 'publish',
                  id: offer.id,
                })
              }
            >
              {offer.status === 'active'
                ? 'Снять с публикации'
                : 'Опубликовать'}
            </Button>
          </OverflowMenu>
        )}
      {action.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(action.error)}
        </p>
      )}
    </Card>
  )
}
export function PurchaseCard({
  purchase: p,
  data,
}: {
  purchase: RewardPurchase
  data: RewardStore
}) {
  const { session, online } = useAuth()
  const action = useRewardAction()
  const me = session!.user.id
  const buyer = p.buyer_id === me
  const open = p.status === 'pending' || p.status === 'ready'
  return (
    <Card className="space-y-3">
      <h3 className="break-words font-semibold">
        {p.emoji} {p.title}
      </h3>
      <p className="text-sm">
        {p.price} Coins · {statuses[p.status]}
      </p>
      <p className="text-xs text-muted-foreground">
        Покупатель: {person(data, p.buyer_id, me)} ·{' '}
        {p.kind === 'joint' ? 'Второй участник' : 'Исполнитель'}:{' '}
        {person(data, p.provider_id, me)}
      </p>
      <p className="text-xs text-muted-foreground">
        {new Date(p.created_at).toLocaleString('ru-RU')}
      </p>
      {p.kind === 'joint' && (
        <p className="text-sm">
          Это совместное событие: оба участвуют добровольно. Платит покупатель,
          готовность подтверждает второй участник, а состоявшееся событие —
          покупатель. Любая сторона может отменить до получения с полным
          возвратом.
        </p>
      )}
      {p.description && (
        <p className="whitespace-pre-wrap break-words text-sm">
          {p.description}
        </p>
      )}
      {open && (
        <p className="text-sm text-muted-foreground">
          Обсудите удобное время лично. Можно отказаться без штрафов; покупателю
          вернутся все Coins.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {open && !buyer && p.status === 'pending' && (
          <Button
            disabled={!online || action.isPending}
            onClick={() =>
              action.mutate({ kind: 'purchase', id: p.id, action: 'ready' })
            }
          >
            Готов(а) исполнить
          </Button>
        )}
        {open && !buyer && (
          <ConfirmationDialog
            trigger={
              <Button variant="outline" disabled={!online || action.isPending}>
                Отказаться и вернуть Coins
              </Button>
            }
            title="Отменить эту награду?"
            description="Покупателю вернутся все потраченные Coins. Эту покупку нельзя будет возобновить."
          >
            {(close) => (
              <Button
                disabled={!online || action.isPending}
                onClick={() => {
                  action.mutate({
                    kind: 'purchase',
                    id: p.id,
                    action: 'refuse',
                  })
                  close()
                }}
              >
                Подтвердить возврат
              </Button>
            )}
          </ConfirmationDialog>
        )}
        {buyer && p.status === 'ready' && (
          <Button
            disabled={!online || action.isPending}
            onClick={() =>
              action.mutate({ kind: 'purchase', id: p.id, action: 'confirm' })
            }
          >
            Я получил(а) награду
          </Button>
        )}
        {buyer && open && (
          <ConfirmationDialog
            trigger={
              <Button variant="outline" disabled={!online || action.isPending}>
                Отменить с возвратом
              </Button>
            }
            title="Отменить эту награду?"
            description="Покупателю вернутся все потраченные Coins. Эту покупку нельзя будет возобновить."
          >
            {(close) => (
              <Button
                disabled={!online || action.isPending}
                onClick={() => {
                  action.mutate({
                    kind: 'purchase',
                    id: p.id,
                    action: 'cancel',
                  })
                  close()
                }}
              >
                Подтвердить возврат
              </Button>
            )}
          </ConfirmationDialog>
        )}
      </div>
      {action.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(action.error)}
        </p>
      )}
    </Card>
  )
}
export function RewardsScreen() {
  const [params] = useSearchParams()
  const query = useRewardStore()
  const { session } = useAuth()
  const [filter, setFilter] = useState('all')
  const [create, setCreate] = useState(false)
  const [visible, setVisible] = useState(20)
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return (
      <Card>
        <p role="alert">{errorMessage(query.error)}</p>
        <Button onClick={() => void query.refetch()}>Повторить</Button>
      </Card>
    )
  const data = query.data
  const linkedPurchase = data.purchases.find(
    (p) => p.id === params.get('purchase') && p.status === 'completed',
  )
  const me = session!.user.id
  const hasPartner = data.couple?.members.length === 2
  const incoming = data.offers.filter(
    (o) => o.status === 'pending' && o.partner_id === me,
  )
  const offers = data.offers.filter((o) =>
    filter === 'pending'
      ? o.status === 'pending' && o.partner_id !== me
      : filter === 'mine'
        ? o.creator_id === me
        : o.status === 'active' &&
          (o.kind === 'joint' || o.creator_id !== me) &&
          (filter === 'all' || o.kind === filter),
  )
  return (
    <div className="space-y-5">
      {params.has('purchase') && (
        <section aria-label="Награда из истории">
          <h2 className="mb-3 font-semibold">Награда из истории</h2>
          {linkedPurchase ? (
            <PurchaseCard purchase={linkedPurchase} data={data} />
          ) : (
            <p>Эта награда больше недоступна.</p>
          )}
        </section>
      )}
      <PageHeader
        title="Награды"
        description="Приятное, которое хочется подарить друг другу."
        action={
          <OverflowMenu label="Магазин">
            <Button disabled={!hasPartner} onClick={() => setCreate(!create)}>
              Создать награду
            </Button>
            <Button variant="ghost" onClick={() => setFilter('mine')}>
              Мои предложения
            </Button>
            <details>
              <summary>Как работают Coins</summary>
              <p>
                Это игровые очки. При покупке списываются только ваши Coins; до
                получения можно отменить с возвратом.
              </p>
            </details>
          </OverflowMenu>
        }
      />
      <div className="flex items-center justify-between">
        <ContextBalance value={data.summary.balance} />
        <span className="text-xs text-muted-foreground">
          Для маленьких радостей
        </span>
      </div>
      {!data.couple && (
        <Card>
          <EmptyState
            title="Начните со своего пространства"
            description="Дела уже помогут заработать Coins, а награды появятся после подключения партнёра."
          />
          <Button asChild>
            <Link to="/space/create">Создать пространство</Link>
          </Button>
        </Card>
      )}
      {data.couple && !hasPartner && (
        <Card>
          <EmptyState
            title="Ждём подключения партнёра"
            description="Ваши Coins сохраняются. Для предложений и покупок нужны два участника."
          />
          <Button asChild>
            <Link to="/space/invite">Пригласить партнёра</Link>
          </Button>
        </Card>
      )}
      {create && hasPartner && (
        <Card>
          <RewardForm close={() => setCreate(false)} />
        </Card>
      )}
      {filter === 'pending' && incoming.length > 0 && (
        <section aria-label="Входящие предложения" className="space-y-3">
          <h2 className="font-semibold">Предложения партнёра</h2>
          {incoming.map((offer) => (
            <RewardOfferCard key={offer.id} offer={offer} data={data} />
          ))}
        </section>
      )}
      <div
        className="segmented-filters"
        role="group"
        aria-label="Фильтры наград"
      >
        {[
          ['all', 'Все награды'],
          ['pending', 'Ожидают решения'],
          ['history', 'История'],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={filter === key ? 'default' : 'outline'}
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key)
              setVisible(20)
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {filter === 'history' ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {[
              [data.summary.earned, 'Заработано'],
              [data.summary.spent, 'Потрачено'],
              [data.summary.refunded, 'Возвращено'],
            ].map(([v, label]) => (
              <Card key={label} className="p-3">
                <p className="break-words text-xs text-muted-foreground">
                  {label}
                </p>
                <p className="mt-2 break-all font-semibold tabular-nums">{v}</p>
              </Card>
            ))}
          </div>
          <section className="space-y-3" aria-label="История покупок">
            <h2 className="font-semibold">Ваши покупки и исполнение</h2>
            {data.purchases.length ? (
              data.purchases
                .slice(0, visible)
                .map((p) => (
                  <PurchaseCard key={p.id} purchase={p} data={data} />
                ))
            ) : (
              <Card>
                <EmptyState
                  title="Покупок пока нет"
                  description="Здесь появятся ожидающие, выполненные и отменённые награды."
                />
              </Card>
            )}
            {data.purchases.length > visible && (
              <Button
                variant="outline"
                onClick={() => setVisible(visible + 20)}
              >
                Ещё покупки
              </Button>
            )}
          </section>
          <Card>
            <h2 className="mb-3 font-semibold">Последние 50 операций Coins</h2>
            {data.transactions.length ? (
              <ul className="space-y-3">
                {data.transactions.map((t) => (
                  <li key={t.id} className="flex justify-between gap-3 text-sm">
                    <span>
                      {t.kind === 'earn'
                        ? 'Заработано'
                        : t.kind === 'spend'
                          ? 'Потрачено'
                          : 'Возвращено'}
                      <span className="block text-xs text-muted-foreground">
                        {new Date(t.created_at).toLocaleString('ru-RU')}
                      </span>
                    </span>
                    <span className="whitespace-nowrap tabular-nums">
                      {t.kind === 'spend' ? '−' : '+'}
                      {t.amount} Coins
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Операций пока нет. Начните с небольшого дела.
              </p>
            )}
          </Card>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {offers.slice(0, visible).map((offer) => (
              <RewardOfferCard key={offer.id} offer={offer} data={data} />
            ))}
          </div>
          {!offers.length && (
            <Card>
              <EmptyState
                title="Здесь появятся ваши награды"
                description="Предложите приятный ритуал, который готовы подарить партнёру. Каталог создаёте только вы вдвоём."
              />
            </Card>
          )}
          {offers.length > visible && (
            <Button variant="outline" onClick={() => setVisible(visible + 20)}>
              Ещё награды
            </Button>
          )}
        </>
      )}
    </div>
  )
}
export function DemoRewardStore() {
  return (
    <Card className="space-y-4">
      <Gift className="text-primary" aria-hidden="true" />
      <h2 className="font-semibold">Пример магазина · деморежим</h2>
      <p className="text-sm text-muted-foreground">
        Общий кошелёк не подключён. Балансы, переводы и платежи не моделируются.
        Только примеры карточек. Покупки, списания, возвраты и пользовательские
        сессии не создаются.
      </p>
      {[
        ['🎬', 'Выбор фильма на вечер', 30],
        ['☕', 'Любимый десерт', 40],
      ].map(([emoji, title, price]) => (
        <div key={title} className="rounded-xl bg-muted p-4">
          <h3 className="font-semibold">
            {emoji} {title}
          </h3>
          <p className="my-2 text-sm">Пример стоимости: {price} Coins</p>
          <Button disabled>Покупки отключены в деморежиме</Button>
        </div>
      ))}
    </Card>
  )
}

function ContextBalance({ value }: { value: number }) {
  return (
    <p className="context-status">
      <Coins size={15} aria-hidden="true" />
      <strong>{value} Coins</strong>
    </p>
  )
}
