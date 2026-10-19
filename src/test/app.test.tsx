// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from '../App'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); localStorage.clear() })
test('missing or invalid configuration is safe', () => {
  expect(isSupabaseConfigured(undefined, undefined)).toBe(false)
  expect(isSupabaseConfigured('not-a-url', 'public')).toBe(false)
  expect(isSupabaseConfigured('https://example.supabase.co', 'public')).toBe(true)
  expect(supabase).toBeNull()
})
test('demo navigation, tasks, validation, theme and wallet restrictions', async () => {
  render(<App />)
  expect(await screen.findByText('Маленькие дела на сегодня')).toBeVisible()
  const nav = screen.getByRole('navigation', {name: 'Основная навигация'})
  expect(within(nav).getAllByRole('link')).toHaveLength(5)
  fireEvent.click(within(nav).getByRole('link', {name:'Дела'}))
  fireEvent.click(screen.getByRole('button', {name:'Добавить дело'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('Введите хотя бы 2 символа')
  fireEvent.change(screen.getByLabelText('Новое дело'), {target:{value:'Вместе полить цветы'}})
  fireEvent.click(screen.getByRole('button', {name:'Добавить дело'}))
  const task = await screen.findByRole('button', {name:'Вместе полить цветы'})
  fireEvent.click(task)
  await waitFor(() => expect(task).toHaveAttribute('aria-pressed', 'true'))
  fireEvent.click(within(nav).getByRole('link', {name:'Цели'}))
  expect(screen.getByText('О чём мечтаете вдвоём?')).toBeVisible()
  fireEvent.click(within(nav).getByRole('link', {name:'Награды'}))
  expect(screen.getByText(/Балансы, переводы и платежи не моделируются/)).toBeVisible()
  expect(screen.queryByRole('button', {name:/купить|перевести|пополнить/i})).not.toBeInTheDocument()
  fireEvent.click(within(nav).getByRole('link', {name:'Мы'}))
  expect(screen.getByText('Два человека. Одна команда.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', {name:'Включить тёмную тему'}))
  expect(localStorage.getItem('kolo-theme')).toBe('dark')
})
