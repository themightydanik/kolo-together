// @vitest-environment jsdom
import { test, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMemoryContext } from '../features/memories/api'
const state = vi.hoisted(() => ({
  session: { user: { id: 'a' } } as object | null,
  couple: {
    data: { members: [{ id: 'epoch-a' }, { id: 'epoch-b' }] },
    isPending: false,
    isFetching: false,
    isError: false,
  },
}))
vi.mock('../features/auth/auth-context', () => ({
  useAuth: () => ({ client: {}, session: state.session, online: true }),
}))
vi.mock('../features/couple/api', () => ({ useCouple: () => state.couple }))
test('memory context remains enabled during background membership fetch, closes on confirmed errors/auth loss and tracks epochs', () => {
  const r = renderHook(() => useMemoryContext())
  expect(r.result.current.enabled).toBe(true)
  state.couple.isFetching = true
  r.rerender()
  expect(r.result.current.enabled).toBe(true)
  expect(r.result.current.context).toBe('epoch-a:epoch-b')
  state.couple.data.members[1].id = 'epoch-c'
  r.rerender()
  expect(r.result.current.context).toBe('epoch-a:epoch-c')
  state.couple.isError = true
  r.rerender()
  expect(r.result.current.enabled).toBe(false)
  state.couple.isError = false
  state.session = null
  r.rerender()
  expect(r.result.current.enabled).toBe(false)
})
