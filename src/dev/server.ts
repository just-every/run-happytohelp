// Vite serve-only entry. Production never imports the local identity layer.
import worker from '../server'
import {devGate,devNotFound} from '@runeditrun/rer/modules/operator-auth'
import {registerDevAdmission} from '@runeditrun/rer/modules/operator-auth/dev-admission'
import {decorateLabel} from '@runeditrun/rer/modules/demo/label'
import {hashToken} from '../platform/auth'
import {serverSecret} from '../platform/db'
import {loginDestination} from '../platform/dashboard-path.js'
import {sessionCookie} from '../modules/identity/session'
import type {Env,Job} from '../platform/env'
export {ConversationSocket} from '../server'
export const DEV_LAYER_MARKER='rer-dev-layer:local-only-never-deploy'
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','X-Rer-Dev-Layer':DEV_LAYER_MARKER}
type Owner={id:string;email:string;projectId:string;role:'owner'}
async function owner(env:Env){
 return env.DB.prepare(`SELECT u.id,u.email,m.project_id projectId,m.role FROM users u JOIN memberships m ON m.user_id=u.id AND m.role='owner' WHERE NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=m.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) ORDER BY CASE WHEN lower(u.email)=lower(?) THEN 0 ELSE 1 END,u.created_at,u.id,m.project_id LIMIT 1`).bind(String(env.OWNER_EMAIL||'')).first<Owner>()
}
export default {
 ...worker,
 async fetch(request:Request,original:Env,execution:ExecutionContext){
  const env:Env={...original,APP_ORIGIN:import.meta.env.RER_LOCAL_ORIGIN||original.APP_ORIGIN}
  const path=new URL(request.url).pathname
  // Managed installations never receive a development identity, even through a local proxy.
  if(env.RER_INSTALLATION_ID){registerDevAdmission(null);return devNotFound()}
  const gate=devGate({key:String(env.RER_DEV_KEY||''),origin:String(env.APP_ORIGIN||''),local:env.H2H_LOCAL==='true'})
  // Native sessions survive top-level OAuth returns; dev sign-in below keeps the stricter gate.
  registerDevAdmission(gate?(r:Request)=>gate.admitsSession(r):null)
  if(path==='/__dev/key')return gate&&env.RER_DEV_IDENTITY!=='off'?await gate.exchange(request)||devNotFound():devNotFound()
  if(path==='/auth/dev/enter'||path==='/__dev/personas'){
   if(!gate||env.RER_DEV_IDENTITY==='off'||!await gate.admits(request))return devNotFound()
   if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers})
   const person=await owner(env)
   if(path==='/__dev/personas')return Response.json([{as:'owner',email:person?.email??null},{as:'signed-out'}],{headers})
   const url=new URL(request.url),as=url.searchParams.get('as')||'owner',reply=new Headers(headers)
   reply.append('Set-Cookie',await gate.setCookie())
   if(as==='signed-out'){
    const token=request.headers.get('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1]
    if(token)await env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').bind(Date.now(),await hashToken(token)).run()
    reply.append('Set-Cookie','h2h_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');reply.set('Location','/login')
   }else{
    if(as!=='owner')return devNotFound()
    if(!person)return new Response('No active owner remains. Run rer setup.',{status:409,headers})
    const token='dev_'+serverSecret()
    const result=await env.DB.prepare(`INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) SELECT ?,m.user_id,m.project_id,m.role,? FROM memberships m WHERE m.user_id=? AND m.project_id=? AND m.role='owner' AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=m.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) RETURNING actor_id`).bind(await hashToken(token),Date.now()+86400000,person.id,person.projectId).all()
    if(result.results.length!==1)return new Response('The owner changed while signing in. Try again.',{status:409,headers})
    reply.append('Set-Cookie',sessionCookie(token,request.url));reply.set('Location',loginDestination(env.RER_DEMO==='1'?'/conversations':url.searchParams.get('returnTo')||'/setup',url.origin))
   }
   return new Response(null,{status:303,headers:reply})
  }
  return decorateLabel(await worker.fetch(request,env,execution),'Dev')
 },
} satisfies ExportedHandler<Env,Job>
