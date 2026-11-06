import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {scope} from '../../management/common'
import {requireStepUp} from '../../identity/two-factor/step-up'
import {readConsent,writeConsent} from './consent'
import {startLink,unlink} from './link'
import {ownStatus,savePreferences,ownOutcomes} from './own'

/** A teammate's own Teams link, preferences and outcomes ('self'), and the owner or
 * admin consent that makes them possible (integrations.install). Outbound only: no
 * Teams event, callback or acknowledgment reaches any of these doors. */
export const teammateTeamsRoutes=new Hono<AppEnv>()
const path='/projects/:projectId/teammate-teams'
const body=async(c:any)=>{try{return await c.req.json()}catch{throw new HTTPException(400)}}
const member=async(c:any)=>{const actor=await scope(c);return {id:actor.id as string,projectId:actor.projectId as string,sessionHash:c.get('sessionHash') as string}}
teammateTeamsRoutes.get(path,async c=>c.json(await ownStatus(c.env,await member(c))))
teammateTeamsRoutes.put(`${path}/preferences`,async c=>c.json(await savePreferences(c.env,await member(c),(await body(c)).preferences)))
teammateTeamsRoutes.post(`${path}/link`,async c=>c.json(await startLink(c.env,await member(c)),201))
teammateTeamsRoutes.delete(`${path}/link`,async c=>c.json(await unlink(c.env,await member(c))))
teammateTeamsRoutes.get(`${path}/outcomes`,async c=>c.json(await ownOutcomes(c.env,await member(c))))
teammateTeamsRoutes.get(`${path}/consent`,async c=>{const actor=await scope(c,true);return c.json(await readConsent(c.env,actor.projectId))})
teammateTeamsRoutes.put(`${path}/consent`,async c=>{
 const actor=await scope(c,true);await requireStepUp(c,actor,'integration.install')
 return c.json(await writeConsent(c.env,{actor:{...actor,role:actor.role as 'owner'|'admin'},sessionHash:c.get('sessionHash')},(await body(c)).connection_id))
})
