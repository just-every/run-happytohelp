import {staticAssetResponse} from '../base/static-assets'
import type {Env} from './env'
import {dashboardSession} from './dashboard-session'

export const projectInboxPath=/^\/projects\/(?!create\/)[^/]+\/conversations\/?$/

/** The built Start shell contains no private data. The document still uses
 * the native session and factor gate before letting the browser load rows. */
export async function inboxDocument(request:Request,env:Env,api:(request:Request)=>Promise<Response>){
 const url=new URL(request.url)
 const session=await dashboardSession(await api(new Request(new URL('/api/identity/session',url),{headers:request.headers,signal:request.signal})))
 if(!session||'twoFactor' in session&&session.twoFactor){
  const destination=new URL(session?'/two-factor':'/login',url)
  destination.searchParams.set('returnTo',url.pathname+url.search)
  return new Response(null,{status:307,headers:{Location:destination.href,'Cache-Control':'no-store'}})
 }
 const asset=await staticAssetResponse(new Request(new URL('/_shell.html',url),{method:request.method}),env)
 if(!asset)throw new Error('Missing built inbox document shell')
 const response=new Response(asset.body,asset)
 response.headers.set('Cache-Control','no-store')
 return response
}
