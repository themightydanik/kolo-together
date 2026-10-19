// Implement adapters only after the target native platforms are chosen.
export interface PlatformAdapter {
  kind: 'web' | 'ios' | 'android'
  hapticFeedback(): Promise<void>
}
export const platform: PlatformAdapter = { kind: 'web', async hapticFeedback() {} }
export interface BillingAdapter {
  getEntitlement(): Promise<'inactive' | 'active'>
  purchase(): Promise<void>
  restore(): Promise<void>
}
// No fake purchases, wallet transfers or entitlement grants in demo mode.
export const billing: BillingAdapter | null = null
