import { expect, test } from 'vitest'
import { errorMessage } from '../lib/errors'

test.each([
  {
    code: '42501',
    message: 'permission denied for table couple_members',
    details: 'SQL SELECT * FROM auth.users',
    hint: 'secret schema hint',
  },
  {
    code: '23505',
    message:
      'duplicate key violates unique constraint one_active_space_per_user',
    details: 'Key (user_id)=(private-uuid) already exists',
  },
  new Error('SQLSTATE P0001 in public.require_verified_user at line 7'),
  { code: 'constructor', message: 'internal implementation details' },
  { code: 'toString', message: 'internal implementation details' },
])(
  'unknown SQL/Auth details are replaced by a static user message',
  (error) => {
    const message = errorMessage(error)
    expect(typeof message).toBe('string')
    expect(message).toBe(
      'Не удалось выполнить действие. Попробуйте ещё раз. Если ошибка повторится, проверьте настройки Supabase.',
    )
    expect(message).not.toMatch(
      /SQL|couple_members|auth\.users|uuid|constraint|schema|require_verified_user/,
    )
  },
)
test('only explicit application errors and Auth codes receive safe translations', () => {
  expect(
    errorMessage({
      code: 'P0001',
      message: 'space_full',
      details: 'private data',
    }),
  ).toBe('В пространстве уже два участника.')
  expect(
    errorMessage({
      code: 'invalid_credentials',
      message: 'sensitive internal explanation',
    }),
  ).toBe('Неверный email или пароль.')
  expect(errorMessage(new TypeError('Failed to fetch'))).toContain(
    'Нет связи с сервером',
  )
})
