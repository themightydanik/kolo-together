import { useState, useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Dialog, Popover } from 'radix-ui'
import { ArrowLeft, ArrowRight, MoreHorizontal, X } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  back,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
  back?: string
}) {
  return (
    <header className="page-heading">
      {back && (
        <Link className="back-link" to={back}>
          <ArrowLeft size={16} />
          Назад
        </Link>
      )}
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1>{title}</h1>
          {description && <p className="page-description">{description}</p>}
        </div>
        {action}
      </div>
    </header>
  )
}
export function PrimaryAction(props: React.ComponentProps<typeof Button>) {
  return <Button {...props} className={cn('primary-action', props.className)} />
}
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  )
}
export function ContextualStatus({
  children,
  tone = 'quiet',
}: {
  children: ReactNode
  tone?: 'quiet' | 'warm' | 'success'
}) {
  return (
    <p role="status" className={'context-status ' + tone}>
      {children}
    </p>
  )
}
export function CompactProgress({
  value,
  total,
  label,
}: {
  value: number
  total: number
  label: string
}) {
  const percent =
    total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className="compact-progress">
      <div>
        <span>{label}</span>
        <span>
          {value} / {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, total)}
      >
        <i style={{ width: percent + '%' }} />
      </div>
    </div>
  )
}
export function OverflowMenu({
  label = 'Действия',
  children,
  locale = 'ru',
}: {
  label?: string
  children: ReactNode
  locale?: 'ru' | 'uk'
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" className="icon-button" aria-label={label}>
          <MoreHorizontal size={22} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="overflow-panel"
          sideOffset={8}
          align="end"
          aria-label={label}
        >
          <div className="flex items-center justify-between gap-2">
            <strong>{label}</strong>
            <Popover.Close asChild>
              <Button
                variant="ghost"
                className="icon-button"
                aria-label={locale === 'uk' ? 'Закрити меню' : 'Закрыть меню'}
              >
                <X size={18} />
              </Button>
            </Popover.Close>
          </div>
          <div className="overflow-actions">{children}</div>
          <Popover.Arrow className="fill-card" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
export function ConfirmationDialog({
  trigger,
  title,
  description,
  children,
  locale = 'ru',
}: {
  trigger: ReactNode
  title: string
  description: string
  children: ReactNode | ((close: () => void) => ReactNode)
  locale?: 'ru' | 'uk'
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="confirmation-dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <div className="mt-6 flex flex-wrap gap-3">
            {typeof children === 'function'
              ? children(() => setOpen(false))
              : children}
            <Dialog.Close asChild>
              <Button variant="outline">
                {locale === 'uk' ? 'Скасувати' : 'Отмена'}
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
export function FeatureEntry({
  to,
  icon,
  title,
  description,
  accent = 'lilac',
}: {
  to: string
  icon: ReactNode
  title: string
  description: string
  accent?: string
}) {
  const titleId = useId(),
    descriptionId = useId()
  return (
    <Link
      to={to}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={'feature-entry ' + accent}
    >
      <span className="entry-icon">{icon}</span>
      <div>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
      </div>
      <ArrowRight size={18} aria-hidden="true" />
    </Link>
  )
}
export function GentleOnboarding({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('kolo:guide:' + id) === 'done'
    } catch {
      return false
    }
  })
  if (dismissed) return null
  return (
    <aside className="onboarding-note">
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
      <Button
        variant="ghost"
        className="icon-button"
        aria-label="Скрыть подсказку"
        onClick={() => {
          setDismissed(true)
          try {
            localStorage.setItem('kolo:guide:' + id, 'done')
          } catch {
            /* optional guidance only */
          }
        }}
      >
        <X size={16} />
      </Button>
    </aside>
  )
}
