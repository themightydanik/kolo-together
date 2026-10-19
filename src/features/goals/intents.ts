import { useSyncExternalStore } from 'react'
import type { GoalChangeKind, GoalPayload } from '../../lib/database.types'
import type { GoalInput } from './model'
export type GoalWrite =
  | { kind: 'create'; space: string; values: GoalInput }
  | {
      kind: 'propose'
      goal: string
      change: GoalChangeKind
      payload: GoalPayload
    }
export type GoalIntent = {
  request: string
  expected: number
  action: GoalWrite
}
const memory = new Map<string, string>()
const listeners = new Set<() => void>()
export const goalIntentScope = (action: GoalWrite) =>
  action.kind === 'create' ? `create:${action.space}` : `change:${action.goal}`
const keyFor = (user: string, scope: string) =>
  `kolo-goal-intent:${user}:${scope}`
function notify() {
  for (const fn of listeners) fn()
}
function valid(raw: string): boolean {
  try {
    const v = JSON.parse(raw)
    return (
      typeof v.request === 'string' &&
      /^[0-9a-f-]{36}$/i.test(v.request) &&
      Number.isSafeInteger(v.expected) &&
      v.expected >= 0 &&
      ((v.action?.kind === 'create' &&
        typeof v.action.space === 'string' &&
        v.action.values &&
        typeof v.action.values.title === 'string') ||
        (v.action?.kind === 'propose' &&
          typeof v.action.goal === 'string' &&
          typeof v.action.change === 'string' &&
          v.action.payload &&
          typeof v.action.payload === 'object'))
    )
  } catch {
    return false
  }
}
function raw(key: string) {
  try {
    const stored = sessionStorage.getItem(key)
    if (stored && valid(stored)) {
      memory.set(key, stored)
      return stored
    }
  } catch {
    /* memory preserves unknown outcomes when storage is disabled */
  }
  return memory.get(key) ?? null
}
export function readGoalIntent(user: string, scope: string): GoalIntent | null {
  const value = raw(keyFor(user, scope))
  return value ? JSON.parse(value) : null
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}
export function goalIntent(
  user: string,
  action: GoalWrite,
  expected: number,
): GoalIntent {
  const scope = goalIntentScope(action),
    key = keyFor(user, scope),
    old = readGoalIntent(user, scope)
  if (old) {
    if (canonical(old.action) !== canonical(action))
      throw Error('goal_intent_pending')
    return old
  }
  const intent = { request: crypto.randomUUID(), expected, action }
  const value = JSON.stringify(intent)
  memory.set(key, value)
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* one record, never rebase the original counter */
  }
  notify()
  return intent
}
export function clearGoalIntent(user: string, scope: string, request?: string) {
  if (request && readGoalIntent(user, scope)?.request !== request) return
  const key = keyFor(user, scope)
  memory.delete(key)
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* runtime record cleared only by explicit user action or known success */
  }
  notify()
}
function subscribe(fn: () => void) {
  listeners.add(fn)
  window.addEventListener('storage', fn)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', fn)
  }
}
export function useGoalIntent(user: string, scope: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => raw(keyFor(user, scope)),
    () => null,
  )
  return value ? (JSON.parse(value) as GoalIntent) : null
}
