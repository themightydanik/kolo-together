// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  MemoriesScreen,
  MemoryDetailScreen,
  MemoryAction,
  MemoryPhotoView,
} from '../features/memories/screens'
import * as photoTools from '../features/memories/images'
import { preparePhoto, MAX_INPUT } from '../features/memories/images'
import {
  memoryError,
  monthLabel,
  type MemoryDetail,
} from '../features/memories/model'
const state = vi.hoisted(() => ({
  client: {} as object | null,
  signedIn: true,
  online: true,
  context: 'epoch',
  rpc: vi.fn(),
  invoke: vi.fn(),
  mutate: vi.fn(),
  feed: {
    isPending: false,
    isError: false,
    isFetching: false,
    isFetchingNextPage: false,
    error: null as unknown,
    data: { pages: [{ items: [] as any[], create_version: 0 }] },
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  },
  detail: {
    isPending: false,
    isError: false,
    isFetching: false,
    error: null as unknown,
    data: null as MemoryDetail | null,
    refetch: vi.fn(),
  },
  write: { isPending: false },
  couple: {
    isPending: false,
    isError: false,
    isFetching: false,
    data: { members: [{ id: 'a' }, { id: 'b' }] },
  },
}))
vi.mock('../features/auth/auth-context', () => ({
  useAuth: () => ({
    client: state.client,
    online: state.online,
    session: state.signedIn ? { user: { id: 'me' } } : null,
  }),
}))
vi.mock('../features/memories/api', () => ({
  useMemoryContext: () => ({
    client: state.client
      ? { rpc: state.rpc, functions: { invoke: state.invoke } }
      : null,
    online: state.online,
    context: state.context,
    session: state.signedIn ? { user: { id: 'me' } } : null,
    enabled: state.online,
    couple: state.couple,
  }),
  useMemoryFeed: () => state.feed,
  useMemoryDetail: () => state.detail,
  useMemoryWrite: () => ({
    isPending: state.write.isPending,
    mutateAsync: state.mutate,
  }),
  useMemorySources: () => ({ isPending: false, isError: false, data: [] }),
}))
function view(ui: React.ReactNode) {
  const client = new QueryClient()
  const tree = (child: React.ReactNode) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/us/history/test']}>
        <Routes>
          <Route path="/us/history/:memoryId" element={child} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  const result = render(tree(ui))
  return {
    ...result,
    rerender: (child: React.ReactNode) => result.rerender(tree(child)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.client = {}
  state.signedIn = true
  state.online = true
  state.context = 'epoch'
  state.feed.isPending = false
  state.feed.isError = false
  state.feed.isFetching = false
  state.feed.data = { pages: [{ items: [], create_version: 0 }] }
  state.detail.isPending = false
  state.detail.isError = false
  state.detail.isFetching = false
  state.couple.isFetching = false
  state.couple.isError = false
  state.detail.data = {
    context: 'epoch',
    memory: {
      id: 'test',
      title: 'Наш день',
      story: 'Збережений текст',
      event_date: '2026-10-01',
      status: 'published',
      author_id: 'me',
      version: 2,
    },
    photos: [],
    notes: [],
  }
  state.mutate.mockResolvedValue({ id: 'test', version: 2 })
  state.invoke.mockResolvedValue({ data: new Blob(['fixture']), error: null })
  state.rpc.mockResolvedValue({ data: null, error: null })
  sessionStorage.clear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:fixture'),
    revokeObjectURL: vi.fn(),
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
test('demo album is beautiful readonly, no pretend memories or storage operations', () => {
  state.client = null
  view(<MemoriesScreen />)
  expect(
    screen.getByRole('heading', { name: 'Наша історія', level: 1 }),
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Додати спогад' })).toBeDisabled()
  expect(screen.getByText(/тут нічого не зберігається/)).toBeVisible()
  expect(state.mutate).not.toHaveBeenCalled()
  expect(state.invoke).not.toHaveBeenCalled()
})
test('empty album and month/date grouping do not duplicate the notification inbox', () => {
  state.feed.data.pages[0].items = [
    {
      id: 'one',
      title: 'Літній день',
      day: '2026-06-21',
      status: 'published',
      cover: null,
      category: 'joy',
    },
    {
      id: 'two',
      title: 'Другий момент',
      day: '2026-06-01',
      status: 'published',
      cover: null,
      category: null,
    },
  ]
  view(<MemoriesScreen />)
  expect(
    screen.getAllByRole('heading', { name: monthLabel('2026-06-21') }),
  ).toHaveLength(1)
  expect(screen.getByText('Літній день')).toBeVisible()
  expect(
    screen.getByRole('link', { name: /Наш шлях і досягнення/ }),
  ).toHaveAttribute('href', '/us/progress')
})
test('offline and access errors never render cached private memory text', () => {
  state.online = false
  const r = view(<MemoryDetailScreen />)
  expect(screen.getByRole('status')).toHaveTextContent('немає зв’язку')
  expect(screen.queryByText('Збережений текст')).toBeNull()
  r.unmount()
  state.online = true
  state.detail.isError = true
  state.detail.error = { message: 'SQL auth.users secret' }
  view(<MemoryDetailScreen />)
  expect(screen.getByRole('alert')).not.toHaveTextContent('SQL')
  expect(screen.queryByText('Збережений текст')).toBeNull()
})
test('own and partner notes stay distinct; own note save never sends another user ID', async () => {
  state.detail.data!.notes = [
    { user_id: 'other', body: 'Слова партнера', version: 3 },
    { user_id: 'me', body: 'Власні слова', version: 2 },
  ]
  view(<MemoryDetailScreen />)
  expect(screen.getByText('Слова партнера')).toBeVisible()
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Твоя особиста нотатка' }),
    { target: { value: 'Мій новий текст' } },
  )
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти мою нотатку' }))
  await waitFor(() => expect(state.mutate).toHaveBeenCalled())
  expect(state.mutate.mock.calls[0][0]).toMatchObject({
    action: 'note',
    expected: 2,
    payload: { body: 'Мій новий текст' },
  })
  expect(state.mutate.mock.calls[0][0].payload).not.toHaveProperty('user_id')
})
test('withdrawn private note projection contains none of the original metadata, source or photos', () => {
  state.detail.data = {
    context: 'epoch',
    memory: { id: 'test', status: 'private_note' },
    notes: [{ user_id: 'me', body: 'Тільки моя нотатка', version: 1 }],
    photos: [],
  }
  view(<MemoryDetailScreen />)
  expect(screen.getByText('Тільки моя нотатка')).toBeVisible()
  expect(screen.queryByText('Наш день')).toBeNull()
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.queryByText('Зберегти мою нотатку')).toBeNull()
})
test('unknown save preserves original UUID/payload on retry, even when storage is blocked', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw Error('blocked')
  })
  state.mutate.mockRejectedValue(Error('timeout'))
  view(
    <MemoryAction
      action="save"
      id="test"
      expected={2}
      payload={{ title: 'Оригінальний намір' }}
    >
      Зберегти спогад
    </MemoryAction>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти спогад' }))
  await screen.findByRole('button', { name: 'Перевірити збереження' })
  const first = state.mutate.mock.calls[0][0]
  fireEvent.click(screen.getByRole('button', { name: 'Перевірити збереження' }))
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith('memory_inspect', {
      p_request: first.request,
    }),
  )
  expect(state.mutate).toHaveBeenCalledTimes(1)
  fireEvent.click(
    screen.getByRole('button', { name: 'Повторити той самий вибір' }),
  )
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(2))
  expect(state.mutate.mock.calls[1][0]).toEqual(first)
})
test('photo bytes use protected function, local URL is revoked on epoch change and unmount', async () => {
  const r = view(<MemoryPhotoView id="photo" />)
  expect(
    await screen.findByRole('img', { name: 'Фото зі спогаду' }),
  ).toHaveAttribute('src', 'blob:fixture')
  expect(state.invoke).toHaveBeenCalledWith('memory-files', {
    body: { action: 'download', id: 'photo' },
  })
  state.context = 'new-epoch'
  r.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture')
})
test('unsupported and oversized input are rejected before any image decoding/upload', async () => {
  await expect(
    preparePhoto(new File(['svg'], 'file.svg', { type: 'image/svg+xml' })),
  ).rejects.toThrow(/JPEG/)
  await expect(
    preparePhoto(
      new File([new Uint8Array(MAX_INPUT + 1)], 'huge.jpg', {
        type: 'image/jpeg',
      }),
    ),
  ).rejects.toThrow(/10 МБ/)
})
test('known conflicts and arbitrary SQL failures are human and safe', () => {
  expect(memoryError({ message: 'memory_changed' })).toContain('іншому вікні')
  expect(memoryError({ message: 'constraint private uuid' })).not.toContain(
    'uuid',
  )
})

test('failed photo upload retains exact reservation and Blob for explicit retry without saving the memory', async () => {
  vi.spyOn(photoTools, 'preparePhoto').mockResolvedValue(
    new Blob(['jpeg'], { type: 'image/jpeg' }),
  )
  vi.spyOn(photoTools, 'photoDigest').mockResolvedValue('a'.repeat(64))
  let uploadAttempts = 0
  state.invoke.mockImplementation((_name, options) =>
    Promise.resolve(
      options.body instanceof FormData && uploadAttempts++ === 0
        ? { error: Error('lost response') }
        : { data: new Blob(['fixture']), error: null },
    ),
  )
  view(<MemoryDetailScreen />)
  fireEvent.click(screen.getByRole('button', { name: 'Дії зі спогадом' }))
  fireEvent.click(screen.getByRole('button', { name: 'Редагувати мій спогад' }))
  fireEvent.change(document.querySelector('input[type=file]')!, {
    target: { files: [new File(['png'], 'image.png', { type: 'image/png' })] },
  })
  await screen.findByRole('button', { name: 'Повторити завантаження фото' })
  const first = state.rpc.mock.calls.find(
    (c) => c[1]?.p_action === 'reserve',
  )![1]
  expect(state.mutate).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Повторити завантаження фото' }),
  )
  await screen.findByRole('button', { name: 'Прибрати фото зі спогаду' })
  const reservations = state.rpc.mock.calls.filter(
    (c) => c[1]?.p_action === 'reserve',
  )
  expect(reservations).toHaveLength(2)
  expect(reservations[1][1]).toEqual(first)
  const uploads = state.invoke.mock.calls.filter(
    (c) => c[1].body instanceof FormData,
  )
  expect(uploads).toHaveLength(2)
  expect(uploads[0][1].body.get('id')).toBe(uploads[1][1].body.get('id'))
  expect(state.mutate).not.toHaveBeenCalled()
})

test('background detail/couple refresh preserves visible editor identity, focus, cursor and every draft field', () => {
  const r = view(<MemoryDetailScreen />)
  fireEvent.click(screen.getByRole('button', { name: 'Дії зі спогадом' }))
  fireEvent.click(screen.getByRole('button', { name: 'Редагувати мій спогад' }))
  const title = screen.getByRole('textbox', {
    name: 'Назва',
  }) as HTMLInputElement
  fireEvent.change(title, { target: { value: 'Незбережений власний текст' } })
  fireEvent.change(screen.getByLabelText('Дата моменту'), {
    target: { value: '2026-07-01' },
  })
  fireEvent.change(screen.getByLabelText('Категорія'), {
    target: { value: 'travel' },
  })
  fireEvent.click(
    screen.getByLabelText(
      'Підтверджую публікацію мого тексту й цих фото для партнера',
    ),
  )
  title.focus()
  title.setSelectionRange(3, 7)
  for (let i = 0; i < 4; i++) {
    state.detail.isFetching = i % 2 === 0
    state.couple.isFetching = i % 2 === 0
    r.rerender(<MemoryDetailScreen />)
    expect(screen.getByRole('textbox', { name: 'Назва' })).toBe(title)
    expect(title).toBeVisible()
    expect(title).toHaveFocus()
    expect(title.selectionStart).toBe(3)
    expect(title.selectionEnd).toBe(7)
    expect(title).toHaveValue('Незбережений власний текст')
    expect(screen.getByLabelText('Дата моменту')).toHaveValue('2026-07-01')
    expect(screen.getByLabelText('Категорія')).toHaveValue('travel')
    expect(
      screen.getByLabelText(
        'Підтверджую публікацію мого тексту й цих фото для партнера',
      ),
    ).toBeChecked()
  }
  state.detail.data = {
    ...state.detail.data!,
    memory: { ...state.detail.data!.memory, version: 3, title: 'Інше вікно' },
  }
  r.rerender(<MemoryDetailScreen />)
  expect(title).toBeVisible()
  expect(title).toHaveValue('Незбережений власний текст')
  expect(screen.getByText(/Спогад змінився в іншому вікні/)).toBeVisible()
  fireEvent.click(
    screen.getByRole('button', { name: 'Оновити збережені дані' }),
  )
  expect(title).toHaveValue('Незбережений власний текст')
  fireEvent.click(
    screen.getByRole('button', { name: 'Відкинути чернетку й оновити' }),
  )
  expect(screen.getByRole('textbox', { name: 'Назва' })).toHaveValue(
    'Інше вікно',
  )
  expect(screen.getByRole('textbox', { name: 'Назва' })).not.toBe(title)
})
test('note refresh never remounts or silently rebases the original CAS with an unsaved body', async () => {
  state.detail.data!.notes = [{ user_id: 'me', body: 'Збережено', version: 2 }]
  const r = view(<MemoryDetailScreen />),
    input = screen.getByRole('textbox', { name: 'Твоя особиста нотатка' })
  fireEvent.change(input, { target: { value: 'Моя локальна чернетка' } })
  state.detail.isFetching = true
  r.rerender(<MemoryDetailScreen />)
  expect(input).toBeVisible()
  state.detail.isFetching = false
  state.detail.data = {
    ...state.detail.data!,
    notes: [{ user_id: 'me', body: 'Інша вкладка', version: 3 }],
  }
  r.rerender(<MemoryDetailScreen />)
  expect(screen.getByRole('textbox', { name: 'Твоя особиста нотатка' })).toBe(
    input,
  )
  expect(input).toHaveValue('Моя локальна чернетка')
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти мою нотатку' }))
  await waitFor(() => expect(state.mutate).toHaveBeenCalled())
  expect(state.mutate.mock.calls[0][0].expected).toBe(2)
})
test('album stays visible while refetching; confirmed epoch/access changes remove private content', () => {
  state.feed.data.pages[0].items = [
    {
      id: 'm',
      title: 'Видимий спогад',
      day: '2026-10-01',
      status: 'published',
      category: null,
      cover: null,
    },
  ]
  const r = view(<MemoriesScreen />)
  const card = screen.getByText('Видимий спогад')
  state.feed.isFetching = true
  state.couple.isFetching = true
  r.rerender(<MemoriesScreen />)
  expect(card).toBeVisible()
  r.unmount()
  const d = view(<MemoryDetailScreen />)
  expect(screen.getByText('Збережений текст')).toBeVisible()
  state.context = 'different-epoch'
  d.rerender(<MemoryDetailScreen />)
  expect(screen.queryByText('Збережений текст')).toBeNull()
  expect(screen.getByRole('alert')).toBeVisible()
})

test('confirmed Auth loss removes private memory and editor instead of retaining stale content', () => {
  const r = view(<MemoryDetailScreen />)
  expect(screen.getByText('Збережений текст')).toBeVisible()
  state.signedIn = false
  r.rerender(<MemoryDetailScreen />)
  expect(screen.queryByText('Збережений текст')).toBeNull()
  expect(screen.getByRole('alert')).toBeVisible()
})

test('an in-flight staging upload and local fields survive background refetch without a second reservation', async () => {
  vi.spyOn(photoTools, 'preparePhoto').mockResolvedValue(
    new Blob(['jpeg'], { type: 'image/jpeg' }),
  )
  vi.spyOn(photoTools, 'photoDigest').mockResolvedValue('a'.repeat(64))
  let finish!: (value: unknown) => void
  const pending = new Promise((resolve) => {
    finish = resolve
  })
  state.invoke.mockImplementation((_name, options) =>
    options.body instanceof FormData
      ? pending
      : Promise.resolve({ data: new Blob(['fixture']), error: null }),
  )
  const r = view(<MemoryDetailScreen />)
  fireEvent.click(screen.getByRole('button', { name: 'Дії зі спогадом' }))
  fireEvent.click(screen.getByRole('button', { name: 'Редагувати мій спогад' }))
  const title = screen.getByRole('textbox', { name: 'Назва' })
  fireEvent.change(title, { target: { value: 'Текст під час завантаження' } })
  fireEvent.change(document.querySelector('input[type=file]')!, {
    target: { files: [new File(['png'], 'photo.png', { type: 'image/png' })] },
  })
  const preview = await screen.findByRole('img', {
    name: 'Попередній перегляд нового фото',
  })
  state.detail.isFetching = true
  state.couple.isFetching = true
  r.rerender(<MemoryDetailScreen />)
  expect(preview).toBeVisible()
  expect(
    screen.getByRole('img', { name: 'Попередній перегляд нового фото' }),
  ).toBe(preview)
  expect(title).toBeVisible()
  expect(title).toHaveValue('Текст під час завантаження')
  state.detail.isFetching = false
  state.couple.isFetching = false
  r.rerender(<MemoryDetailScreen />)
  finish({ data: { id: 'photo' }, error: null })
  await screen.findByRole('button', { name: 'Прибрати фото зі спогаду' })
  expect(
    state.rpc.mock.calls.filter((c) => c[1]?.p_action === 'reserve'),
  ).toHaveLength(1)
  expect(
    state.invoke.mock.calls.filter((c) => c[1].body instanceof FormData),
  ).toHaveLength(1)
  expect(title).toHaveValue('Текст під час завантаження')
})
