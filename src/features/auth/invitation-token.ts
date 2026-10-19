const key = 'kolo-pending-invitation'
// Keep the bearer token out of query strings, server request logs and referers.
// Session storage survives email/login redirects in this tab, not a permanent login.
export function captureInvitationToken(): void {
  if (window.location.pathname !== '/invite') return
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return
  try {
    sessionStorage.setItem(key, token)
  } catch {
    return
  }
  window.history.replaceState(null, '', '/invite')
}
export function invitationToken(): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}
export function clearInvitationToken(): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* No persistent storage. */
  }
}
export function authDestination(): string {
  return invitationToken() ? '/invite' : '/'
}
export function authRedirect(path: string): string {
  return new URL(path, window.location.origin).href
}
