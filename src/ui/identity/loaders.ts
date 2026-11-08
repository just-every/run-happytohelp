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
 const { nativeLoaderResponse, nativeLoaderError } = await import('../../platform/native-loader.server')
 const response = await nativeLoaderResponse('/api/identity/session')
 if (response.status === 401) { await response.body?.cancel(); return false }
 // A busy database is neither signed out nor a failure: the workspace's own reads decide, and retry.
 if (response.status === 503) { await response.body?.cancel(); return {busy: true} as const }
 if (!response.ok) throw await nativeLoaderError(response)
 const actor = await response.json() as {projectId?: string; role: string; twoFactor?: 'verify'|'enrol'}
 return {projectId:actor.projectId,editorAuthorized: Boolean(!actor.twoFactor && actor.projectId && ['owner','admin'].includes(actor.role)),twoFactor:actor.twoFactor}
})
