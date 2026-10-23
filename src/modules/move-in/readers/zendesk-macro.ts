import type {MacroActions} from '../../macros/schema'
import {tagKey,text} from './common'

const placeholders:Record<string,string>={
 'ticket.requester.name':'requester.name','ticket.requester.first_name':'requester.first_name','ticket.requester.email':'requester.email',
 'ticket.assignee.name':'assignee.name','ticket.assignee.email':'assignee.email','current_user.name':'agent.name','current_user.email':'agent.email',
 'ticket.title':'ticket.subject','ticket.id':'ticket.id','ticket.url':'ticket.link','ticket.organization.name':'organization.name',
}
/** A finite translation, never a Liquid interpreter. Unknown expressions stay
 * visible in review; the native reply gate also refuses unresolved placeholders. */
export function zendeskMacroBody(body:string,omissions:string[]){
 if(/{%|{#/.test(body))throw new Error('macro_template_logic_not_supported')
 return body.replace(/{{\s*([^{}]+?)\s*}}/g,(literal,key:string)=>{
  const native=placeholders[key.trim()]
  if(!native){omissions.push(`macro_placeholder_unsupported:${key.trim()}`);return literal}
  return `{{${native}}}`
 })
}
export function zendeskMacroActions(source:any[],tagIds:Map<string,string>,omissions:string[]):MacroActions{
 const result:MacroActions={reply_type:'public'},seen=new Set<string>()
 for(const action of source){
  if(!action||typeof action.field!=='string')throw new Error('macro_action_invalid')
  const {field,value}=action
  if(seen.has(field))throw new Error('duplicate_macro_action');seen.add(field)
  if(['comment_value','comment_value_html'].includes(field))continue
  if(field==='comment_mode_is_public'){
   if(![true,false,'true','false'].includes(value))throw new Error('macro_visibility_invalid')
   result.reply_type=value===true||value==='true'?'public':'note'
  }else if(field==='priority'){
   if(!['low','normal','high','urgent'].includes(value))throw new Error('macro_priority_invalid')
   result.priority=value
  }else if(field==='status'){
   if(!['new','open','pending','hold','solved','closed'].includes(value))throw new Error('macro_status_unsupported')
   result.status_id=value==='hold'?'on_hold':value
  }else if(field==='current_tags'||field==='remove_tags'){
   const names=text(value,'macro_tags_required',8000).split(/\s+/).filter(Boolean)
   const ids=names.map(name=>tagIds.get(tagKey(name)))
   if(ids.some(id=>!id))throw new Error('macro_tag_mapping_missing')
   result[field==='current_tags'?'tags_add':'tags_remove']=[...new Set(ids as string[])]
  }else omissions.push(`macro_action_unsupported:${field}`)
 }
 return result
}
