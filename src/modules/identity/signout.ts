import {Hono, type Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireActor} from '../../platform/auth'
import {auditStatement,requestSource} from '../audit/record'
import {clearSessionCookie} from './session'

/** Revoke only the credential authenticated by requireActor, with its audit row. */
export async function endSession(c:Context<AppEnv>){
 const actor=await requireActor(c),sessionHash=c.get('sessionHash'),now=Date.now()
 await c.env.DB.batch([
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'auth',action:'session.signed_out',actor:{type:'user',id:actor.id},source:requestSource(c)},now,{sql:'EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND revoked_at IS NULL)',params:[sessionHash]}),
  c.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(now,sessionHash),
 ])
 c.header('Cache-Control','no-store')
 c.header('Set-Cookie',clearSessionCookie(c.req.url))
}

export const signout=new Hono<AppEnv>()
signout.post('/signout',async c=>{
 // This cookie-bearing public door also serves rer's owner-claim retirement.
 // Require an explicit same-origin POST, including for bearer-authenticated callers.
 if(c.req.header('Origin')!==new URL(c.req.url).origin||c.req.header('Sec-Fetch-Site')==='cross-site')throw new HTTPException(403,{message:'Sign out must be submitted from this site'})
 await endSession(c)
 return c.body(null,204)
})
