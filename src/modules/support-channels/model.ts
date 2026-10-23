import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {AppEnv,Env,Actor} from '../../platform/env'
import {scope} from '../management/common'
import {memberAccess} from '../access/gate'
import type {Permission} from '../access/catalogue'
import {hashToken} from '../../platform/auth'
import {contactAvailableSql} from '../conversations/contact-privacy'
export type Provider='sms'|'whatsapp'|'instagram'|'messenger'|'slack'
export interface Connection {id:string;project_id:string;provider:Provider;account:string;sender:string;channels_json:string;token_cipher:string|null;signing_cipher:string|null;verify_hash:string;registered:number;revoked_at:number|null}
export const prefix='/projects/:projectId'
export async function access(c:Context<AppEnv>,permission?:Permission){const actor=await scope(c) as Actor;if(permission&&!(await memberAccess(c.env.DB,actor.projectId,actor.id))?.permissions.has(permission))throw new HTTPException(403,{message:'Your role cannot perform this channel action'});return actor}
export function text(value:unknown,label:string,max=200){if(typeof value!=='string'||!value.trim()||value.length>max)throw new HTTPException(400,{message:`Invalid ${label}`});return value.trim()}
export const digest=hashToken
export const liveConnection=`revoked_at IS NULL AND token_cipher IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_settings p WHERE p.project_id=support_channel_connections.project_id AND json_extract(p.settings_json,'$.deleted_at') IS NOT NULL)`
export async function connection(env:Env,id:string){const row=await env.DB.prepare(`SELECT * FROM support_channel_connections WHERE id=? AND ${liveConnection}`).bind(id).first<Connection>();if(!row)throw new HTTPException(410,{message:'Channel disconnected; reconnect explicitly in Settings → Support channels'});return row}
export async function thread(env:Env,projectId:string,conversationId:string){return env.DB.prepare(`SELECT t.*,c.provider,c.account,c.sender,c.registered,c.token_cipher,c.revoked_at FROM support_channel_threads t JOIN support_channel_connections c ON c.id=t.connection_id JOIN conversations conv ON conv.id=t.conversation_id AND conv.project_id=t.project_id WHERE t.project_id=? AND t.conversation_id=? AND ${contactAvailableSql('conv')}`).bind(projectId,conversationId).first<any>()}
