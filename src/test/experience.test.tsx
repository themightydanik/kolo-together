// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { test, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TodayFocus } from '../features/experience/screens'
import {
  ConfirmationDialog,
  OverflowMenu,
  CompactProgress,
  GentleOnboarding,
} from '../components/experience'
import { Button } from '../components/ui/button'
const state = vi.hoisted(() => ({
  home: {
    active_game_id: null as string | null,
    events: [] as { session_id: string; position: number }[],
  },
}))
vi.mock('../features/auth/auth-context', () => ({
  useAuth: () => ({ client: {}, session: { user: { id: 'a' } } }),
}))
vi.mock('../features/connection/api', () => ({
  useConnection: () => ({ data: state.home, isError: false }),
}))
beforeEach(() => {
  state.home = { active_game_id: null, events: [] }
  localStorage.clear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(cleanup)
test('Today gives a partner invitation priority over generic prompts and an existing game', () => {
  state.home = {
    active_game_id: 'current',
    events: [{ session_id: 'invited', position: 8 }],
  }
  render(
    <MemoryRouter>
      <TodayFocus pending={1} />
    </MemoryRouter>,
  )
  expect(
    screen.getByRole('link', { name: 'Открыть нашу карту' }),
  ).toHaveAttribute('href', '/us/connection/session/invited?card=8')
  expect(screen.getAllByRole('link')).toHaveLength(1)
})
test('Today highlights a real pending proposal before a general unfinished game', () => {
  state.home.active_game_id = 'game'
  render(
    <MemoryRouter>
      <TodayFocus pending={1} />
    </MemoryRouter>,
  )
  expect(
    screen.getByRole('link', { name: 'Посмотреть предложение' }),
  ).toHaveAttribute('href', '/tasks')
})
test('Today resumes an unfinished game instead of creating a new one', () => {
  state.home.active_game_id = 'game'
  render(
    <MemoryRouter>
      <TodayFocus />
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: 'Продолжить игру' })).toHaveAttribute(
    'href',
    '/us/connection/session/game',
  )
})
test('solo context has one path to setup', () => {
  render(
    <MemoryRouter>
      <TodayFocus hasPartner={false} />
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: 'Начать вместе' })).toHaveAttribute(
    'href',
    '/us/settings',
  )
})
test('dangerous action cannot run when opening a confirmation or cancelling it', () => {
  const mutate = vi.fn()
  render(
    <ConfirmationDialog
      trigger={<Button>Удалить</Button>}
      title="Удалить ответы?"
      description="Будут удалены только ваши тексты."
    >
      <Button onClick={mutate}>Подтвердить</Button>
    </ConfirmationDialog>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Удалить ответы?')
  expect(mutate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(mutate).not.toHaveBeenCalled()
})
test('confirmation runs only after the explicit confirmation', () => {
  const mutate = vi.fn()
  render(
    <ConfirmationDialog
      trigger={<Button>Удалить</Button>}
      title="Удалить ответы?"
      description="Только ваши тексты."
    >
      <Button onClick={mutate}>Подтвердить</Button>
    </ConfirmationDialog>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
  expect(mutate).toHaveBeenCalledTimes(1)
})
test('overflow is closed initially, exposes secondary actions only on demand', () => {
  render(
    <OverflowMenu label="Действия">
      <Button>Редкое действие</Button>
    </OverflowMenu>,
  )
  expect(
    screen.queryByRole('button', { name: 'Редкое действие' }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Действия' }))
  expect(screen.getByRole('dialog', { name: 'Действия' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Редкое действие' })).toBeVisible()
})
test('zero-step progress is accessible and never claims completion', () => {
  render(<CompactProgress label="Шаги" value={0} total={0} />)
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  expect(screen.getByText('0 / 0')).toBeVisible()
})
test('optional onboarding dismisses only that guide, not consent or data', () => {
  const v = render(
    <GentleOnboarding id="example" title="Одна идея">
      Можно начать с малого.
    </GentleOnboarding>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Скрыть подсказку' }))
  v.unmount()
  render(
    <GentleOnboarding id="example" title="Одна идея">
      Можно начать с малого.
    </GentleOnboarding>,
  )
  expect(screen.queryByText('Одна идея')).not.toBeInTheDocument()
  expect(localStorage.getItem('kolo:guide:example')).toBe('done')
})
