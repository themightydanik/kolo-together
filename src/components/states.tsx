import { AlertCircle, LoaderCircle, Sprout } from 'lucide-react'
import { Button } from './ui/button'
export function LoadingState() { return <p role="status" className="flex items-center gap-2 p-6"><LoaderCircle className="animate-spin" aria-hidden="true" />Загружаем ваше пространство…</p> }
export function EmptyState({title, description}: {title: string; description: string}) { return <div className="py-8 text-center"><Sprout className="mx-auto mb-3 text-primary" aria-hidden="true" /><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{description}</p></div> }
export function ErrorState({retry}: {retry: () => void}) { return <div role="alert" className="space-y-3 p-6"><AlertCircle aria-hidden="true" /><p>Не получилось загрузить данные. Попробуйте ещё раз.</p><Button onClick={retry}>Повторить</Button></div> }
