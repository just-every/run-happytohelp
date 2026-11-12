import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {AppEnv} from '../../../platform/env'
import {hashToken} from '../../../platform/auth'
import {enforceRole,memberAccess} from '../../access/gate'
import {importActor} from '../routes'
import {encodeCursor} from './cursor'
import {readQuery} from './query'
import {ticketProjection,articleProjection} from './projection'
import * as reads from './reads'
const root='/projects/:projectId/zendesk/diagnostics'
export const zendeskDiagnosticsRoutes=new Hono<AppEnv>()
/** A complete project census cannot be authorized by a narrowed ticket/article selection. */
async function completeProject(c:Context<AppEnv>){
 const actor=await importActor(c)
 await enforceRole(c,c.get('actor'),'data.import')
 const access=await memberAccess(c.env.DB,actor.project_id,actor.actor_id)
 if(!access||!access.permissions.has('data.import')||access.ticketScope!==null||access.knowledgeArticleIds!==null)throw new HTTPException(403)
 return actor.project_id
}
/** Keep even authentication refusals and storage errors non-cacheable and non-disclosing. */
async function answer(c:Context<AppEnv>,read:()=>Promise<unknown>){
 c.header('Cache-Control','no-store')
 try{return c.json({data:await read()})}
 catch(error){const status=error instanceof HTTPException&&[401,403,404].includes(error.status)?error.status: error instanceof Error&&['invalid_query','invalid_cursor'].includes(error.message)?400:503
  return c.json({error:status===400?'Invalid diagnostics query':status===503?'Diagnostics unavailable':'Diagnostics access refused'},status as 400|401|403|404|503)}
}
zendeskDiagnosticsRoutes.get(`${root}/summary`,c=>answer(c,async()=>{
 const project=await completeProject(c)
 readQuery(c.req.url,await hashToken(project),'summary')
 return reads.summary(c.env.DB,project)
}))
zendeskDiagnosticsRoutes.get(`${root}/tickets`,c=>answer(c,async()=>{
 const project=await completeProject(c),binding=await hashToken(project),page=readQuery(c.req.url,binding,'tickets'),rows=await reads.tickets(c.env.DB,project,page),selected=rows.slice(0,page.limit)
 return {rows:selected.map(ticketProjection),nextCursor:rows.length>page.limit?encodeCursor(binding,'tickets',selected.at(-1)!.position):null}
}))
zendeskDiagnosticsRoutes.get(`${root}/articles`,c=>answer(c,async()=>{
 const project=await completeProject(c),binding=await hashToken(project),page=readQuery(c.req.url,binding,'articles'),rows=await reads.articles(c.env.DB,project,page),selected=rows.slice(0,page.limit)
 return {rows:selected.map(articleProjection),nextCursor:rows.length>page.limit?encodeCursor(binding,'articles',selected.at(-1)!.position):null}
}))
