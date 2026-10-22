// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useActivitySummary, useActivityWrite } from '../features/activity/api'
const state = vi.hoisted(() => ({
  online: true,
  epoch: 'epoch-one',
  fetching: false,
  rpc: vi.fn(),
}))
vi.mock('../features/auth/auth-context', () => ({
  useAuth: () => ({
    client: { rpc: state.rpc },
    session: { user: { id: 'me' } },
    online: state.online,
  }),
}))
vi.mock('../features/couple/api', () => ({
  useCouple: () => ({
    data: { members: [{ id: state.epoch }] },
    isPending: false,
    isError: false,
    isFetching: state.fetching,
  }),
}))
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {children}
    </QueryClientProvider>
  )
}
beforeEach(() => {
  state.online = true
  state.epoch = 'epoch-one'
  state.fetching = false
  state.rpc.mockReset()
  state.rpc.mockResolvedValue({
    data: {
      context: 'epoch-one',
      unread: 1,
      spotlight: null,
      reactions_enabled: true,
    },
    error: null,
  })
})
afterEach(cleanup)
test('summary requires verified membership context and rejects stale envelopes without exposing cached count', async () => {
  state.fetching = true
  const h = renderHook(() => useActivitySummary(), { wrapper })
  expect(state.rpc).not.toHaveBeenCalled()
  state.fetching = false
  h.rerender()
  await waitFor(() => expect(h.result.current.isSuccess).toBe(true))
  expect(h.result.current.data?.unread).toBe(1)
  state.epoch = 'epoch-two'
  h.rerender()
  await waitFor(() => expect(h.result.current.isError).toBe(true))
  expect(h.result.current.data).toBeUndefined()
  expect(h.result.current.error?.message).toBe('activity_context_changed')
})
test('offline mutation fails immediately, cannot enter a paused mutation queue and never resends on reconnect', async () => {
  state.online = false
  const h = renderHook(() => useActivityWrite(), { wrapper })
  await act(async () => {
    await expect(
      h.result.current.mutateAsync({ kind: 'read', id: 'event' }),
    ).rejects.toThrow('offline')
  })
  expect(state.rpc).not.toHaveBeenCalled()
  expect(h.result.current.isPaused).toBe(false)
  state.online = true
  h.rerender()
  expect(state.rpc).not.toHaveBeenCalled()
})
test('reaction RPC transports the original UUID, CAS and payload only once; no automatic retry', async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } })
  const h = renderHook(() => useActivityWrite(), { wrapper }),
    intent = {
      event: 'e',
      kind: 'support' as const,
      expected: null,
      request: 'original',
    }
  await act(async () => {
    await expect(
      h.result.current.mutateAsync({ kind: 'reaction', intent }),
    ).rejects.toEqual({ message: 'timeout' })
  })
  expect(state.rpc).toHaveBeenCalledTimes(1)
  expect(state.rpc).toHaveBeenCalledWith('set_activity_reaction', {
    p_event: 'e',
    p_kind: 'support',
    p_expected: null,
    p_request: 'original',
  })
})
