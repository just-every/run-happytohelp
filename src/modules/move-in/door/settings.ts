import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {requireActor} from '../../../platform/auth'
import {writeImportDoorSettings} from '../../import-kit/src/door/index'
import {claimConfiguration,claimedDestination,ownerPredicate} from './authority'

/** Backend owner close/revocation control; no new owner task or UI. */
export const importDoorSettings=new Hono<AppEnv>()
const path='/projects/:projectId/business-imports'
importDoorSettings.use(path,async(c,next)=>{
 const actor=await requireActor(c)
 if(actor.role!=='owner')throw new HTTPException(403,{message:'Workspace owner required'})
 const claim=claimConfiguration(c.env,new URL(c.req.url).origin),binding=claim&&await claimedDestination(c.env,claim)
 if(!binding||binding.owner_id!==actor.id||binding.project_id!==c.req.param('projectId'))throw new HTTPException(403,{message:'Claimed workspace owner required'})
 await next()
})
importDoorSettings.get(path,async c=>{
 const claim=claimConfiguration(c.env)!
 const row=await c.env.DB.prepare('SELECT enabled FROM ik_door_settings WHERE installation_id=?').bind(claim.installationId).first<{enabled:number}>()
 const keys=await c.env.DB.prepare('SELECT kid FROM ik_door_revoked_keys WHERE installation_id=? ORDER BY kid').bind(claim.installationId).all<{kid:string}>()
 return c.json({enabled:row?.enabled===1,revokedKids:keys.results.map(row=>row.kid)})
})
importDoorSettings.post(path,async c=>{
 if(c.req.header('Sec-Fetch-Site')==='cross-site'||c.req.header('Origin')&&c.req.header('Origin')!==new URL(c.req.url).origin)throw new HTTPException(403)
 if(c.req.header('Content-Type')?.split(';')[0]!=='application/json')throw new HTTPException(400)
 const body=await c.req.json().catch(()=>null)
 if(!body||typeof body.enabled!=='boolean'||Object.keys(body).some(key=>!['enabled','revokedKids'].includes(key))||body.revokedKids!==undefined&&(!Array.isArray(body.revokedKids)||body.revokedKids.some((kid:unknown)=>typeof kid!=='string')) )throw new HTTPException(400)
 const claim=claimConfiguration(c.env)!,binding=(await claimedDestination(c.env,claim))!,native=ownerPredicate(claim,binding)
 const predicate={sql:`(${native.sql}) AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND actor_id=? AND project_id=? AND role='owner' AND revoked_at IS NULL AND expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER))`,params:[...native.params!,c.get('sessionHash'),binding.owner_id,binding.project_id]}
 await writeImportDoorSettings(c.env.DB,claim.installationId,body,predicate)
 return c.json({enabled:body.enabled})
})
