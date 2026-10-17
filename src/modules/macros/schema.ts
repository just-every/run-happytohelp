import {invalid,object,named} from '../tickets/model'
export interface MacroScope {visibility:'personal'|'group'|'shared';roles:string[];groups:string[];brands:string[]}
export interface MacroActions {reply_type?:'public'|'note';status_id?:string;priority?:string;tags_add?:string[];tags_remove?:string[];agent_id?:string|null;group_id?:string|null;followers?:string[];fields?:Record<string,unknown>;attachments?:string[]}
export interface MacroDefinition {title:string;content:string;actions:MacroActions;scope:MacroScope}
export function ids(value:unknown,label:string,max=100):string[]{
 if(!Array.isArray(value)||value.length>max||value.some(v=>typeof v!=='string'||!v||v.length>200))invalid(`Invalid ${label}`)
 return [...new Set(value as string[])]
}
export function definition(input:unknown):MacroDefinition{
 const b=object(input),title=named(b.title,200),content=b.content??''
 if(typeof content!=='string'||content.length>50000)invalid('Reply must be text up to 50,000 characters')
 const actions=object(b.actions??{}) as MacroActions
 if(Object.keys(actions).some(k=>!['reply_type','status_id','priority','tags_add','tags_remove','agent_id','group_id','followers','fields','attachments'].includes(k)))invalid('Unknown macro action')
 if(actions.reply_type!==undefined&&!['public','note'].includes(actions.reply_type))invalid('Choose a public reply or internal note')
 for(const key of ['tags_add','tags_remove','followers','attachments'] as const)if(actions[key]!==undefined)actions[key]=ids(actions[key],key,key==='attachments'?10:100)
 for(const key of ['agent_id','group_id'] as const)if(actions[key]!==undefined&&actions[key]!==null&&(typeof actions[key]!=='string'||!actions[key]))invalid(`Invalid ${key}`)
 if(actions.status_id!==undefined)named(actions.status_id,200)
 if(actions.priority!==undefined&&!['low','normal','high','urgent'].includes(actions.priority))invalid('Invalid priority')
 if(actions.fields!==undefined)object(actions.fields)
 if(!content&&!Object.keys(actions).some(k=>k!=='reply_type'))invalid('Add reply text or an action')
 const raw=object(b.scope??{}),visibility=raw.visibility??'shared'
 if(!['personal','group','shared'].includes(visibility))invalid('Choose a macro visibility')
 const scope={visibility,roles:ids(raw.roles??[],'roles'),groups:ids(raw.groups??[],'groups'),brands:ids(raw.brands??[],'brands')} as MacroScope
 if(visibility==='group'&&!scope.groups.length)invalid('Choose at least one group')
 return {title,content,actions,scope}
}
