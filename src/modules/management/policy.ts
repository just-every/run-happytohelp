import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {scope,text} from './common'
import {modelReadiness} from './provisioning/index'
import {PRESENCE_IDLE_MINUTES,presenceSettings} from './availability'
import {visitorAssistant} from './live-availability'
import {onlineTeammates} from '../collaboration/presence-store'
import {auditStatement,requestSource} from '../audit/record'
export const projectPolicy=new Hono<AppEnv>()
/** Merges `patch` into the workspace settings, batched with the statements `also` derives from the old and new values. */
async function save(env:Env,projectId:string,patch:Record<string,unknown>,also:(old:any,value:any)=>D1PreparedStatement[]=()=>[]){const row=await env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(projectId).first<{settings_json:string}>(),old=JSON.parse(row?.settings_json||'{}'),value={...old,...patch};await env.DB.batch([env.DB.prepare('INSERT INTO project_settings VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at').bind(projectId,JSON.stringify(value),Date.now()),...also(old,value)]);return value}
const presenceSummary=(settings:any)=>{const presence=presenceSettings(settings);return `${presence.enabled?'On':'Off'}, ${presence.idleMinutes} min idle`}
projectPolicy.put('/projects/:projectId/availability',async c=>{
 const a=await scope(c,true),b=await c.req.json(),schedule=b.availability_schedule||{}
 if(b.is_availability_schedule_enabled&&(!Array.isArray(schedule.days)||!schedule.days.length||schedule.days.some((v:unknown)=>!Number.isInteger(v)||Number(v)<1||Number(v)>7)||!/^\d{2}:\d{2}$/.test(schedule.time_from)||!/^\d{2}:\d{2}$/.test(schedule.time_to)||schedule.time_to<=schedule.time_from))throw new HTTPException(400,{message:'Availability requires weekdays and an increasing HH:MM interval'})
 const patch:Record<string,unknown>={is_availability_schedule_enabled:Boolean(b.is_availability_schedule_enabled),availability_schedule:{days:schedule.days||[],time_from:schedule.time_from||null,time_to:schedule.time_to||null,message:schedule.message?text(schedule.message,2000):''}}
 // Presence-based away: during open hours, away while no teammate who may reply is online.
 if('is_presence_away_enabled' in b)patch.is_presence_away_enabled=Boolean(b.is_presence_away_enabled)
 if('presence_idle_minutes' in b){const minutes=Number(b.presence_idle_minutes);if(!PRESENCE_IDLE_MINUTES.includes(minutes))throw new HTTPException(400,{message:`Choose an idle time of ${PRESENCE_IDLE_MINUTES.join(', ')} minutes`});patch.presence_idle_minutes=minutes}
 if('presence_away_message' in b)patch.presence_away_message=b.presence_away_message?text(b.presence_away_message,2000):''
 // Turning presence-based away on or off, or changing when a teammate counts as idle, is recorded in the security log.
 return c.json({data:await save(c.env,a.projectId,patch,(old,value)=>presenceSummary(old)===presenceSummary(value)?[]:[auditStatement(c.env.DB,{projectId:a.projectId,category:'data',action:'availability.presence_changed',actor:{type:'user',id:a.id},source:requestSource(c),target:{type:'project',id:a.projectId},detail:{from:presenceSummary(old),to:presenceSummary(value)}})])})
})
// Whether the default visitor assistant can answer: its provider and the installation secret it needs, never key material.
projectPolicy.get('/projects/:projectId/ai',async c=>{
 const a=await scope(c)
 const assistant=await visitorAssistant(c.env,a.projectId)
 return c.json({data:assistant?{assistant,...modelReadiness(c.env,assistant.model)}:{assistant:null,ready:false}})
})
// Who counts as online for presence-based away now, and the visitor assistant that keeps the team available when it answers.
projectPolicy.get('/projects/:projectId/presence',async c=>{
 const a=await scope(c),row=await c.env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(a.projectId).first<{settings_json:string}>()
 const settings=JSON.parse(row?.settings_json||'{}'),assistant=await visitorAssistant(c.env,a.projectId)
 return c.json({data:{online:await onlineTeammates(c.env,a.projectId,presenceSettings(settings).idleMinutes),assistant:assistant&&modelReadiness(c.env,assistant.model).ready?{id:assistant.id,name:assistant.name}:null}})
})
projectPolicy.put('/projects/:projectId/ai',async c=>{const a=await scope(c,true),b=await c.req.json(),patch:Record<string,unknown>={};for(const key of ['default_visitor_ai_id','default_verified_user_ai_id'])if(key in b){const ai=b[key]==='-'?null:b[key];if(ai&&!await c.env.DB.prepare('SELECT id FROM ai_profiles WHERE id=? AND project_id=? AND is_enabled=1').bind(ai,a.projectId).first())throw new HTTPException(400);patch[key]=ai}if('is_human_response_enabled' in b)patch.is_human_response_enabled=Boolean(b.is_human_response_enabled);if('default_visitor_ai_id' in patch)patch.default_responder=patch.default_visitor_ai_id;return c.json({data:await save(c.env,a.projectId,patch)})})
projectPolicy.put('/projects/:projectId/agents/:userId/primary',async c=>{const a=await scope(c);if(c.req.param('userId')!==a.id)throw new HTTPException(403);const b=await c.req.json();await c.env.DB.batch([c.env.DB.prepare('UPDATE user_project_preferences SET is_primary=0 WHERE user_id=?').bind(a.id),c.env.DB.prepare('INSERT INTO user_project_preferences(project_id,user_id,is_primary) VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET is_primary=excluded.is_primary').bind(a.projectId,a.id,b.is_primary?1:0)]);return c.json({updated:true})})
