export function errorMessage(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : ''
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : ''
  const known: Record<string, string> = {
    invalid_credentials: 'Неверный email или пароль.',
    email_not_confirmed: 'Подтвердите email по ссылке из письма.',
    user_already_exists:
      'Не удалось зарегистрироваться. Попробуйте войти или восстановить пароль.',
    over_email_send_rate_limit:
      'Письма отправляются слишком часто. Подождите немного.',
    weak_password: 'Выберите более надёжный пароль (минимум 8 символов).',
    same_password: 'Новый пароль должен отличаться от прежнего.',
    otp_expired: 'Ссылка истекла. Запросите новое письмо.',
    email_address_invalid: 'Проверьте адрес электронной почты.',
  }
  if (known[code]) return known[code]
  if (
    /Failed to fetch|fetch failed|NetworkError|network|offline/i.test(message)
  )
    return 'Нет связи с сервером. Проверьте сеть и повторите попытку.'
  if (/already_in_space/.test(message))
    return 'Вы уже в пространстве. Чтобы присоединиться к другому, сначала выйдите из текущего.'
  if (/space_full/.test(message)) return 'В пространстве уже два участника.'
  if (/invitation_unavailable/.test(message))
    return 'Приглашение недоступно: проверьте аккаунт, срок действия или запросите новую ссылку.'
  if (/verified_account_required/.test(message))
    return 'Войдите в аккаунт с подтверждённым email.'
  if (/cannot_invite_self/.test(message))
    return 'Укажите email партнёра, а не свой.'
  if (/space_required/.test(message)) return 'Сначала создайте пространство.'
  return 'Не удалось выполнить действие. Попробуйте ещё раз. Если ошибка повторится, проверьте настройки Supabase.'
}
