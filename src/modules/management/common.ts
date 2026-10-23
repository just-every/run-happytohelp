import {activeEnterpriseMember} from '../identity/enterprise/authority'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../../platform/env'
import { requireActor } from '../../platform/auth'
export async function scope(c:Context<AppEnv>,admin=false){const actor=await requireActor(c);if(actor.role==='contact')throw new HTTPException(403);const project=c.req.param('projectId')||c.req.query('projectId')||actor.projectId;const member=await c.env.DB.prepare(`SELECT m.role FROM memberships m JOIN projects p ON p.id=m.project_id WHERE m.project_id=? AND m.user_id=? AND ${activeEnterpriseMember('m.user_id','m.project_id')} AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=m.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`).bind(project,actor.id).first<{role:'owner'|'admin'|'operator'}>();if(!member)throw new HTTPException(403,{message:'Project not found, or you do not have access to it'});if(admin&&!['admin','owner'].includes(member.role))throw new HTTPException(403,{message:'Project owner or admin role required'});return {...actor,projectId:project,role:member.role}}
export function text(value:unknown,max=2000){if(typeof value!=='string'||value.length>max)throw new HTTPException(400,{message:'Invalid text'});return value.trim()}
export function url(value:unknown){const result=new URL(text(value));if(result.protocol!=='https:'&&!(result.protocol==='http:'&&['localhost','127.0.0.1'].includes(result.hostname)))throw new HTTPException(400,{message:'HTTPS URL required'});return result.href}
export const decode=(row:any)=>row?{...row,...JSON.parse(row.settings_json||'{}')}:row
