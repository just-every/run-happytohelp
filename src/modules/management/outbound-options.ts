import {Hono} from 'hono'
import type {Actor,AppEnv} from '../../platform/env'
import {scope} from './common'
import {ticketAuthority,fieldAllowed,fieldData} from '../tickets/model'
import {decodeForm,fieldCatalogue} from '../forms/store'
import {operatorForm,outboundAccountOptions} from './outbound-configuration'

/** Offers use the same create authority as admission, never settings authority. */
export function outboundOptionsRoutes(){
 const routes=new Hono<AppEnv>()
 routes.get('/projects/:projectId/tickets/options',async c=>{
  const actor=await scope(c) as Actor,guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'conversations.reply')
  const [rows,catalogue,groups,members,groupMembers]=await Promise.all([
   c.env.DB.prepare('SELECT * FROM request_forms WHERE project_id=? AND enabled=1 ORDER BY updated_at,id').bind(actor.projectId).all<any>(),fieldCatalogue(c.env,actor.projectId),
   c.env.DB.prepare('SELECT id,name FROM ticket_groups WHERE project_id=? ORDER BY name,id').bind(actor.projectId).all<any>(),
   c.env.DB.prepare('SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? ORDER BY u.name,u.id').bind(actor.projectId).all<any>(),
   c.env.DB.prepare('SELECT group_id,user_id FROM ticket_group_members WHERE project_id=?').bind(actor.projectId).all<any>()
  ])
  const forms=[]
  for(const row of rows.results){const form=decodeForm(row);if(form.fields.every(ref=>{const f=catalogue.find(f=>f.id===ref.fieldId);return f&&fieldAllowed(f,guard.access)&&fieldAllowed(f,guard.access,true)}))forms.push((await operatorForm(c.env,actor,form.id,guard.access)).definition)}
  const requesterId=c.req.query('requesterId'),accounts=requesterId?await outboundAccountOptions(c.env,actor.projectId,requesterId):[]
  // Recheck the native session and role before returning workspace customer choices.
  if(!await c.env.DB.prepare(`SELECT 1 WHERE EXISTS(${guard.sql})`).bind(...guard.params).first())return c.json({error:'Create authority changed'},403)
  c.header('Cache-Control','no-store')
  return c.json({actorId:actor.id,forms,fields:catalogue.filter(f=>fieldAllowed(f,guard.access)&&fieldAllowed(f,guard.access,true)).map(f=>({...fieldData(f,guard.access),required:false,...(f.type==='account'?{accountOptions:accounts}:{})})),accounts,groups:groups.results.map(group=>({...group,members:groupMembers.results.filter(member=>member.group_id===group.id).map(member=>member.user_id)})),members:members.results})
 })
 routes.get('/projects/:projectId/tickets/requesters',async c=>{
  const actor=await scope(c) as Actor,guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'conversations.reply'),query=(c.req.query('q')??'').trim().slice(0,320)
  if(!query)return c.json({data:[]})
  const rows=await c.env.DB.prepare(`SELECT ct.id,ct.name,ct.email,json_extract(ct.metadata_json,'$.phone') phone FROM contacts ct WHERE ct.project_id=? AND (instr(lower(coalesce(ct.name,'')),lower(?))>0 OR instr(lower(coalesce(ct.email,'')),lower(?))>0 OR instr(coalesce(json_extract(ct.metadata_json,'$.phone'),''),?)>0) AND coalesce(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_deleted'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1 AND EXISTS(${guard.sql}) ORDER BY ct.name,ct.id LIMIT 20`).bind(actor.projectId,query,query,query,...guard.params).all()
  c.header('Cache-Control','no-store');return c.json({data:rows.results})
 })
 return routes
}
