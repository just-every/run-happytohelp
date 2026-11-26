import { createServerFn } from '@tanstack/react-start'

export type SetupInitialState = {
 state: 'available' | 'complete' | 'unavailable'
 tokenRequired: boolean
 error: string
 signedIn?: boolean
}

// Protected imports stay inside the handler; the browser receives RPC stubs.
export const loadSetup = createServerFn({ method: 'GET' }).handler(async (): Promise<SetupInitialState> => {
 const { nativeLoaderResponse, nativeLoaderError } = await import('../../platform/native-loader.server')
 try {
  const response = await nativeLoaderResponse('/api/identity/setup')
  if (!response.ok) throw await nativeLoaderError(response)
  const result = await response.json() as { available: boolean; tokenRequired?: boolean; signedIn?: boolean }
  return { state: result.available ? 'available' : 'complete', tokenRequired: Boolean(result.tokenRequired), signedIn: result.signedIn, error: '' }
 } catch (error) {
  return { state: 'unavailable', tokenRequired: false, error: error instanceof Error ? error.message : String(error) }
 }
})

export const checkNativeSession = createServerFn({ method: 'GET' }).handler(async () => {
 const { nativeLoaderResponse } = await import('../../platform/native-loader.server')
 const { dashboardSession } = await import('../../platform/dashboard-session')
 return dashboardSession(await nativeLoaderResponse('/api/identity/session'))
})
