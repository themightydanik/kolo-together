// @vitest-environment jsdom
import { beforeEach, afterEach, test, expect, vi } from 'vitest'
const action = {
  kind: 'create' as const,
  space: 'space',
  values: {
    title: 'Вместе в горы',
    description: '',
    category: 'travel' as const,
    emoji: '🏔️' as const,
    target_date: '',
  },
}
beforeEach(() => {
  sessionStorage.clear()
  vi.resetModules()
})
afterEach(() => vi.restoreAllMocks())
test('reload keeps original UUID, full payload and history fence instead of adopting refreshed history', async () => {
  const first = await import('../features/goals/intents')
  const old = first.goalIntent('a', action, 4)
  vi.resetModules()
  const reload = await import('../features/goals/intents')
  expect(reload.goalIntent('a', action, 99)).toEqual(old)
  expect(() =>
    reload.goalIntent(
      'a',
      { ...action, values: { ...action.values, title: 'Другие условия' } },
      99,
    ),
  ).toThrow('goal_intent_pending')
})
test('disabled storage keeps memory retry; complete storage/runtime loss and isolated tabs require server fence', async () => {
  let tab = new Map<string, string>()
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
    (k) => tab.get(k) ?? null,
  )
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => {
    tab.set(k, v)
  })
  const first = await import('../features/goals/intents')
  const old = first.goalIntent('a', action, 0)
  tab = new Map()
  vi.resetModules()
  const second = await import('../features/goals/intents')
  expect(second.goalIntent('a', action, 0).request).not.toBe(old.request)
  vi.mocked(Storage.prototype.getItem).mockImplementation(() => {
    throw Error('storage disabled')
  })
  vi.mocked(Storage.prototype.setItem).mockImplementation(() => {
    throw Error('storage disabled')
  })
  expect(first.goalIntent('a', action, 20)).toEqual(old)
  vi.resetModules()
  const lost = await import('../features/goals/intents')
  expect(lost.goalIntent('a', action, 0).request).not.toBe(old.request)
})
test('explicit discard creates a new intent; account namespaces never reuse private payloads', async () => {
  const api = await import('../features/goals/intents')
  const old = api.goalIntent('a', action, 0)
  expect(api.readGoalIntent('b', 'create:space')).toBeNull()
  api.clearGoalIntent('a', 'create:space', old.request)
  expect(api.goalIntent('a', action, 1).request).not.toBe(old.request)
})
