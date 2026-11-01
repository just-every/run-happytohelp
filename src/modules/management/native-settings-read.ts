import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'

/** Native Settings and assistant defaults only. Never spread stored configuration
 * into the response: unknown fields, connections and credentials stay in storage. */
export async function readNativeSettings(env:Env,projectId:string){
 const row=await env.DB.prepare('SELECT p.id,p.name,p.widget_key,p.allowed_origin,s.settings_json FROM projects p LEFT JOIN project_settings s ON s.project_id=p.id WHERE p.id=?').bind(projectId).first<{id:string;name:string;widget_key:string;allowed_origin:string;settings_json:string|null}>()
 if(!row)throw new HTTPException(404,{message:'Project not found'})
 const source=JSON.parse(row.settings_json||'{}')
 if(!source||typeof source!=='object'||Array.isArray(source))throw new HTTPException(500,{message:'Workspace settings could not load'})
 // The widget key is a public installation identifier (IDENTITY-001).
 const data:Record<string,unknown>={id:row.id,name:row.name,widget_key:row.widget_key,allowed_origin:row.allowed_origin}
 for(const key of ['website','timezone','help_center_domain','primary_color','display_mode','sidebar_artwork_id','brand_image_url','logo_url','brand_name','avatar_url','welcome_message','unavailable_message','presence_away_message','default_visitor_ai_id','default_verified_user_ai_id']){
  if(typeof source[key]==='string'||source[key]===null)data[key]=source[key]
 }
 for(const key of ['is_contact_tracking_enabled','proactive_help_enabled','sidebar_artwork_enabled','is_available','is_availability_schedule_enabled','is_presence_away_enabled','is_human_response_enabled']){
  if(typeof source[key]==='boolean')data[key]=source[key]
 }
 if(typeof source.presence_idle_minutes==='number')data.presence_idle_minutes=source.presence_idle_minutes
 const schedule=source.availability_schedule
 if(schedule&&typeof schedule==='object'&&!Array.isArray(schedule)){
  const safe:Record<string,unknown>={}
  for(const key of ['time_from','time_to','message'])if(typeof schedule[key]==='string'||schedule[key]===null)safe[key]=schedule[key]
  if(Array.isArray(schedule.days))safe.days=schedule.days.filter((day:unknown)=>typeof day==='number')
  data.availability_schedule=safe
 }
 return data
}
