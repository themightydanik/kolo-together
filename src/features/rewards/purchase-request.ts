// Intent UUID + history fence are one atomic storage record. Retrying must not
// silently adopt a newer fence: a rejected stale intent would become a new debit.
type Intent = { request: string; expected: number | null }
const fallback = new Map<string, Intent>()
const keyFor = (userId: string, offerId: string) =>
  `kolo-purchase:${userId}:${offerId}`
function read(key: string): Intent | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (raw) {
      // Compatibility with unresolved UUIDs from the initial PR implementation.
      if (/^[0-9a-f-]{36}$/i.test(raw)) return { request: raw, expected: 0 }
      const value = JSON.parse(raw)
      if (
        typeof value.request === 'string' &&
        /^[0-9a-f-]{36}$/i.test(value.request) &&
        (value.expected === null ||
          (Number.isSafeInteger(value.expected) && value.expected >= 0))
      )
        return value
    }
  } catch {
    /* storage disabled or corrupt: retain the runtime's original intent */
  }
  return fallback.get(key) ?? null
}
function save(key: string, value: Intent) {
  fallback.set(key, value)
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* memory retry */
  }
}
export function purchaseRequest(userId: string, offerId: string) {
  const key = keyFor(userId, offerId)
  const value = read(key) ?? { request: crypto.randomUUID(), expected: null }
  save(key, value)
  return value.request
}
export function purchaseIntent(
  userId: string,
  offerId: string,
  expected: number,
) {
  purchaseRequest(userId, offerId)
  const key = keyFor(userId, offerId)
  const value = read(key)!
  if (value.expected === null) value.expected = expected
  save(key, value)
  return { request: value.request, expected: value.expected! }
}
export function clearPurchaseRequest(userId: string, offerId: string) {
  const key = keyFor(userId, offerId)
  fallback.delete(key)
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* non-sensitive intent only */
  }
}
export function pendingPurchaseRequest(userId: string, offerId: string) {
  return read(keyFor(userId, offerId))?.request ?? null
}
