// UUIDs are not credentials. Keep unresolved requests per account/offer so that
// closing/reopening the screen after a lost response cannot spend twice.
const fallback = new Map<string, string>()
const keyFor = (userId: string, offerId: string) =>
  `kolo-purchase:${userId}:${offerId}`
export function purchaseRequest(userId: string, offerId: string) {
  const key = keyFor(userId, offerId)
  let id = fallback.get(key)
  try {
    id = sessionStorage.getItem(key) ?? id
  } catch {
    /* in-memory fallback */
  }
  if (!id) id = crypto.randomUUID()
  fallback.set(key, id)
  try {
    sessionStorage.setItem(key, id)
  } catch {
    /* same mounted runtime */
  }
  return id
}
export function clearPurchaseRequest(userId: string, offerId: string) {
  const key = keyFor(userId, offerId)
  fallback.delete(key)
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* non-sensitive pending UUID */
  }
}
