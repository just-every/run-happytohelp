import {Hono,type Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from './common'
import {activationConfiguration} from './activation/configuration'
import {activationFacts} from './activation/facts'
import {activationSnapshot} from './activation/snapshot'
import {finishCheck,readReceipts,startCheck} from './activation/store'
import {setSkip,skipLocalTrial,skippable} from './activation/skips'
import {stepIds,type StepId,type Probe} from './activation/types'
import {runChecks} from './activation/checks'
import {reconcileStarter} from './activation/starter'
import {sendOwnerTestMail} from './activation/mail-probes'
import {ProbeFailure} from './activation/provider-http'

export const activation=new Hono<AppEnv>()
const path='/projects/:projectId/activation'
async function ownerScope(c:Parameters<typeof scope>[0]) {
 const actor=await scope(c,true)
 // Membership checks alone do not deny a path project whose memberships were retained in a partial deletion.
 if(await c.env.DB.prepare("SELECT project_id FROM project_settings WHERE project_id=? AND json_extract(settings_json,'$.deleted_at') IS NOT NULL").bind(actor.projectId).first())throw new HTTPException(403)
 return actor
}
/** The snapshot as stored now. Reads only: no provider request and no write. */
async function snapshotResponse(c:Context<AppEnv>,projectId:string) {
 const [config,receipts]=await Promise.all([activationConfiguration(c.env,projectId),readReceipts(c.env,projectId)])
 const facts=await activationFacts(c.env,config,receipts,String(c.env.APP_ORIGIN||new URL(c.req.url).origin))
 c.header('Cache-Control','no-store')
 return c.json({data:activationSnapshot(config,receipts,facts)})
}
activation.get(path,async c=>snapshotResponse(c,(await ownerScope(c)).projectId))
activation.post(`${path}/check`,async c=>{
 const actor=await ownerScope(c),body=await c.req.json()
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='step'&&key!=='auto')||body.step!==undefined&&!stepIds.includes(body.step)||body.auto!==undefined&&body.auto!==true)throw new HTTPException(400,{message:'Choose a checklist step to check, optionally with auto: true; completion cannot be set manually.'})
 const ids:StepId[]=body.step?[body.step]:stepIds
 let config=await activationConfiguration(c.env,actor.projectId)
 // An untouched starter follows the provider whose key is installed before its key is validated.
 if(ids.includes('model_key')&&await reconcileStarter(c.env,actor.projectId,config.settings))config=await activationConfiguration(c.env,actor.projectId)
 await runChecks(c.env,config,ids,body.auto===true)
 return snapshotResponse(c,actor.projectId)
})
activation.post(`${path}/skip`,async c=>{
 const actor=await ownerScope(c),body=await c.req.json().catch(()=>null)
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='step'&&key!=='skipped')||!skippable.includes(body.step)||typeof body.skipped!=='boolean')throw new HTTPException(400,{message:`Choose one of ${skippable.join(', ')} and whether to skip it for now (skipped: true or false).`})
 await setSkip(c.env,actor.projectId,body.step,body.skipped)
 return snapshotResponse(c,actor.projectId)
})
// Try locally without a website or AI key: a local trial leaves its widget and AI key steps for now in one request.
activation.post(`${path}/local-trial`,async c=>{
 const actor=await ownerScope(c),body=await c.req.json().catch(()=>null)
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new HTTPException(400,{message:'Trying locally takes no options: send an empty object.'})
 if((await activationConfiguration(c.env,actor.projectId)).environment!=='local')throw new HTTPException(409,{message:'Only a local trial skips its widget and AI key together. Skip each step on its own.'})
 await skipLocalTrial(c.env,actor.projectId)
 return snapshotResponse(c,actor.projectId)
})
activation.post(`${path}/test-mail`,async c=>{
 const actor=await ownerScope(c)
 if(actor.role!=='owner')throw new HTTPException(403,{message:'Only a workspace owner can send their test mail.'})
 const body=await c.req.json()
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw new HTTPException(400,{message:'Test mail goes only to the authenticated owner; no recipient or completion can be supplied.'})
 const config=await activationConfiguration(c.env,actor.projectId),token=await startCheck(c.env,config,'owner_mail')
 if(token) {
  let result:Probe
  try {result=await sendOwnerTestMail(c.env,config,actor.id)}catch(error){result=error instanceof ProbeFailure?error.probe:{state:'unknown',detail:'Test mail outcome is unknown. Reconcile provider status before any further send.'}}
  await finishCheck(c.env,config,'owner_mail',token,result)
 }
 return snapshotResponse(c,actor.projectId)
})
