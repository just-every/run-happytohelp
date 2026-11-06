import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {issuerGuard,type Issuer} from '../../platform/integration-authority'
import {requireStepUp} from '../identity/two-factor/step-up'
import {encryptToken,decryptToken} from '../integrations/secrets'
import {jsonBody,readBody} from './http'
import {pullScout} from './helpscout-pull'
import {ScoutError} from './helpscout-client'
export const helpscoutSettings=new Hono<AppEnv>(),helpscoutWebhooks=new Hono<AppEnv>()
const root='/projects/:projectId/connections/helpscout'
async function reviewer(c:any):Promise<Issuer>{const actor=await scope(c,true);if(!['owner','admin'].includes(actor.role))throw new HTTPException(403);return {actor:{...actor,role:actor.role as 'owner'|'admin'},sessionHash:c.get('sessionHash')}}
export const scoutPublic=(row:any)=>row?{connected:!!row.secret_ciphertext,mailbox_id:row.mailbox_id,cursor:row.cursor,has_more:!!row.next_page,last_pull_at:row.last_pull_at,error_class:row.error_class,waiting_events:row.waiting_events,last_run_id:row.last_run_id,skipped_erased:row.skipped_erased}: {connected:false,cursor:null,waiting_events:0}
helpscoutSettings.get(root,async c=>{const who=await reviewer(c);return c.json(scoutPublic(await c.env.DB.prepare('SELECT * FROM helpscout_connections WHERE project_id=?').bind(who.actor.projectId).first()))})
helpscoutSettings.put(root,async c=>{
 const who=await reviewer(c);await requireStepUp(c,who.actor,'integration.install');const b=await jsonBody(c)
 for(const key of ['app_id','app_secret','webhook_secret','mailbox_id'])if(typeof b[key]!=='string'||!b[key]||b[key].length>4096)throw new HTTPException(400,{message:'App ID, app secret, webhook secret and mailbox ID required'})
 if(!/^[1-9][0-9]{0,15}$/.test(b.mailbox_id))throw new HTTPException(400)
 const guard=await issuerGuard(c.env,who),cipher=await encryptToken(c.env,who.actor.projectId,JSON.stringify({app_id:b.app_id,app_secret:b.app_secret,webhook_secret:b.webhook_secret}))
 const result=await c.env.DB.prepare(`INSERT INTO helpscout_connections(project_id,mailbox_id,secret_ciphertext) SELECT ?,?,? WHERE EXISTS(${guard.sql}) ON CONFLICT(project_id) DO UPDATE SET secret_ciphertext=excluded.secret_ciphertext,revision=revision+1,error_class=NULL,claim=NULL,claim_until=NULL WHERE helpscout_connections.mailbox_id=excluded.mailbox_id`).bind(who.actor.projectId,b.mailbox_id,cipher,...guard.params).run()
 if(!result.meta.changes)throw new HTTPException(409,{message:'Existing cursor belongs to another mailbox or authority changed'})
 return c.json({connected:true})
})
helpscoutSettings.delete(root,async c=>{const who=await reviewer(c);await requireStepUp(c,who.actor,'integration.install');const guard=await issuerGuard(c.env,who);await c.env.DB.prepare(`UPDATE helpscout_connections SET secret_ciphertext=NULL,revision=revision+1,claim=NULL,claim_until=NULL,error_class=NULL WHERE project_id=? AND EXISTS(${guard.sql})`).bind(who.actor.projectId,...guard.params).run();return c.json({connected:false})})
helpscoutSettings.post(root+'/pull',async c=>{const who=await reviewer(c);await jsonBody(c);try{return c.json(await pullScout(c.env,who,c.req.raw.headers,c.executionCtx),202)}catch(error){if(!(error instanceof ScoutError))throw error;const status=error.code==='pull_in_progress'?409:502;return c.json({error:{code:error.code,message:'Help Scout pull did not finish. Review the connection and pull again.'}},status)}})
// Signed intake has no native/API bearer authority and stores no source content.
helpscoutWebhooks.post('/projects/:projectId/webhook',async c=>{
 const project=c.req.param('projectId'),row=await c.env.DB.prepare('SELECT secret_ciphertext,revision FROM helpscout_connections WHERE project_id=? AND secret_ciphertext IS NOT NULL').bind(project).first<any>()
 if(!row)throw new HTTPException(404)
 const bytes=await readBody(c,65536,false),signature=c.req.header('X-HelpScout-Signature')??''
 let supplied:Uint8Array<ArrayBuffer>;try{supplied=Uint8Array.from(atob(signature),ch=>ch.charCodeAt(0))}catch{throw new HTTPException(401)}
 const secret=JSON.parse(await decryptToken(c.env,project,row.secret_ciphertext)),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret.webhook_secret),{name:'HMAC',hash:'SHA-1'},false,['verify'])
 if(supplied.length!==20||!await crypto.subtle.verify('HMAC',key,supplied,bytes))throw new HTTPException(401)
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join(''),now=Date.now()
 const result=await c.env.DB.batch([
  c.env.DB.prepare('INSERT OR IGNORE INTO helpscout_events SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM helpscout_connections WHERE project_id=? AND revision=? AND secret_ciphertext IS NOT NULL)').bind(project,digest,now,project,row.revision),
  c.env.DB.prepare('UPDATE helpscout_connections SET waiting_events=waiting_events+changes() WHERE project_id=? AND revision=? AND secret_ciphertext IS NOT NULL').bind(project,row.revision)
 ])
 return c.json({accepted:true,duplicate:!result[0].meta.changes},202)
})
