import { type Row,type LegacyBundle,type MappedRow,timestamp,text,stable } from './types'
import {columns,truth} from './mapping-shared'
import {legacyWidgetProjectSettings} from './legacy-widget'

function helpCenterAddress(value:unknown){
 if(value===null||value===undefined||value==='')return value
 const input=text(value,'projects.help_center_domain').trim()
 const address=new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input)?input:`https://${input}`)
 if(address.username||address.password||!address.hostname||(address.protocol!=='https:'&&!(address.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(address.hostname))))throw new Error('Invalid legacy Help Center URL')
 return address.href
}

/** The workspace's native settings row from its legacy project row; its widget as legacy-widget.ts translates it. */
export function projectSettings(r:Row):MappedRow{
 const metadata=(typeof r.metadata==='string'?JSON.parse(r.metadata):r.metadata||{}) as Row
 const settings:Row={
  ...((metadata.dashboard||{}) as Row),
  ...Object.fromEntries(Object.entries(columns(r,['default_visitor_ai_id','default_verified_user_ai_id','is_availability_schedule_enabled','is_contact_tracking_enabled','is_human_response_enabled','timezone','help_center_domain','deleted_at'])).map(([key,value])=>[key,key.startsWith('is_')?truth(value):value])),
  ...legacyWidgetProjectSettings(r),
  ...(r.avatar_url?{logo_url:r.avatar_url}:{})
 }
 if('help_center_domain' in settings)settings.help_center_domain=helpCenterAddress(settings.help_center_domain)
 return {table:'project_settings',row:{project_id:text(r.id,'projects.id'),settings_json:stable(settings),updated_at:timestamp(r.updated_at||r.created_at)},key:['project_id']}
}

export function mapProject(r:Row,b:LegacyBundle):MappedRow[]{
 const id=text(r.id,'projects.id'),name=text(r.name,'projects.name'),updated=timestamp(r.updated_at||r.created_at)
 const result:MappedRow[]=[{table:'projects',row:{id,name,widget_key:r.widget_key||r.public_key||id,allowed_origin:new URL(text(r.allowed_origin||r.website||r.website_url||r.url,'projects.allowed_origin')).origin,created_at:timestamp(r.created_at),verification_secret:r.verification_secret??null},key:['id']}]
 result.push(projectSettings(r))
 // Legacy mail settings are never verified here, so they always arrive disabled.
 // A package exported without the legacy MAIL_FROM_DOMAIN keeps the sender and
 // holds the inbound mailbox until an operator supplies and verifies the domain.
 let inbound:string|null=null,hold:string|undefined
 if(r.slug){
  const slug=text(r.slug,'projects.slug')
  if(b.source.mailboxPending===true&&b.source.mailFromDomain===undefined)hold=`Legacy inbound mailbox ${slug}@mail.<MAIL_FROM_DOMAIN> is not verified; set and verify the domain before enabling email`
  else{
   const domain=text(b.source.mailFromDomain,'source.mailFromDomain (legacy mail.from.domain)')
   if(!/^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(domain)||domain.split('.').some(part=>!part||part.startsWith('-')||part.endsWith('-')))throw new Error('Invalid legacy mail domain')
   inbound=`${slug}@mail.${domain}`
  }
  result.push({table:'public_project_aliases',row:{slug,project_id:id},key:['slug'],...(hold&&!r.email_from_address?{hold}:{})})
 }
 if(inbound||r.email_from_address){
  result.push({table:'email_settings',row:{project_id:id,from_name:r.email_from_name||name,from_address:r.email_from_address||inbound,inbound_address:inbound,is_enabled:0,updated_at:updated},key:['project_id'],...(hold?{hold}:{})})
 }
 return result
}
