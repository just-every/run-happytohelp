import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from './common'

export const brands=new Hono<AppEnv>()
/** Brands use workspace security boundaries. Selecting brands never grants access,
 * copies customer identities or shares a mailbox credential. */
brands.get('/projects/:projectId/brands',async c=>{
 const actor=await scope(c,true)
 const ids=[...new Set((c.req.query('projects')||'').split(',').filter(Boolean))]
 if(!ids.length||ids.length>20||!ids.includes(actor.projectId)||ids.some(id=>!/^[-a-zA-Z0-9_]{1,200}$/.test(id)))throw new HTTPException(400,{message:'Explicitly select this brand and up to 19 other brands'})
 const permitted=async(id:string)=>{
  const row=await c.env.DB.prepare(`SELECT p.id,p.name,p.allowed_origin,p.widget_key,m.role,s.settings_json FROM projects p
   JOIN memberships m ON m.project_id=p.id AND m.user_id=? LEFT JOIN project_settings s ON s.project_id=p.id
   WHERE p.id=? AND json_extract(COALESCE(s.settings_json,'{}'),'$.deleted_at') IS NULL`).bind(actor.id,id).first<any>()
  if(!row||!['owner','admin'].includes(row.role))throw new HTTPException(403,{message:'Every selected brand requires its own current owner or admin membership; invite teammates to each brand separately'})
  return row
 }
 const data=[],members=new Map<string,{id:string;name:string;roles:Record<string,string>}>()
 for(const id of ids){
  const row=await permitted(id),settings=JSON.parse(row.settings_json||'{}')
  const [mail,team,aliases]=await c.env.DB.batch<any>([
   c.env.DB.prepare('SELECT id,provider,address,display_name,sender_address,status FROM mailbox_connections WHERE project_id=? ORDER BY created_at,id').bind(id),
   c.env.DB.prepare('SELECT u.id,u.name,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? ORDER BY u.id').bind(id),
   c.env.DB.prepare('SELECT slug FROM public_project_aliases WHERE project_id=?').bind(id),
  ])
  let hosts:Record<string,unknown>={}
  try{const value=JSON.parse(c.env.PUBLIC_HELP_HOSTS||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))hosts=value}catch{}
  const helpKeys=new Set([id,...aliases.results.map(alias=>alias.slug)])
  data.push({id:row.id,name:row.name,origin:row.allowed_origin,widgetKey:row.widget_key,helpCenterContextUrl:settings.help_center_domain||null,helpCenterPath:`/help/${id}`,helpHosts:Object.entries(hosts).filter(([,key])=>typeof key==='string'&&helpKeys.has(key)).map(([host])=>host),mailboxes:mail.results,
   policy:{timezone:settings.timezone||'UTC',collectEmail:settings.collect_email!==false,acceptNewConversations:settings.is_enabled!==false},
   settingsUrl:`/projects/${id}/edit`,membersUrl:`/projects/${id}/agents`})
  for(const person of team.results){const member=members.get(person.id)||{id:person.id,name:person.name,roles:{} as Record<string,string>};member.roles[id]=person.role;members.set(person.id,member)}
 }
 // Recheck after reading the whole selection, including changes made in-flight.
 await scope(c,true)
 for(const id of ids)await permitted(id)
 c.header('Cache-Control','no-store')
 return c.json({data:{brands:data,sharedTeam:[...members.values()].filter(member=>ids.every(id=>member.roles[id])),explanation:'Each workspace is a separate brand. Shared teammates must accept an invitation to every brand. Settings and routing are managed in that brand; customer identities, private knowledge and sender credentials are never copied. Customer handoffs require a separately authorized conversation in the destination brand.'}})
})
