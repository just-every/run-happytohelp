import {invalid,named,object,priorities} from '../tickets/model'
export type WorkflowAction=
 |{type:'status';status_id:string}|{type:'priority';priority:string}
 |{type:'assign';user_id:string|null;group_id?:string|null}
 |{type:'tags';add?:string[];remove?:string[]}
 |{type:'fields';values:Record<string,unknown>}
 |{type:'note';content:string}
 |{type:'notify';kind:string;recipient_id?:string;message?:string}
 |{type:'webhook';destination_id:string}
 |{type:'route'}
export function checkedActions(raw:unknown):WorkflowAction[]{
 if(!Array.isArray(raw)||raw.length>20)invalid('Use at most 20 actions')
 return raw.map(value=>{const a=object(value)
  switch(a.type){
   case 'status':return {type:a.type,status_id:named(a.status_id,200)}
   case 'priority':if(!priorities.includes(a.priority))invalid('Unknown priority');return {type:a.type,priority:a.priority}
   case 'assign':if(a.user_id!==null&&(typeof a.user_id!=='string'||!a.user_id))invalid('Choose an operator or unassigned');if(a.group_id!==undefined&&a.group_id!==null&&(typeof a.group_id!=='string'||!a.group_id))invalid('Invalid group');return {type:a.type,user_id:a.user_id,...(a.group_id===undefined?{}:{group_id:a.group_id})}
   case 'tags':{const add=a.add??[],remove=a.remove??[];for(const ids of [add,remove])if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!id||id.length>200))invalid('Tags must be workspace IDs');return {type:a.type,add:[...new Set(add)] as string[],remove:[...new Set(remove)] as string[]}}
   case 'fields':return {type:a.type,values:object(a.values)}
   case 'note':return {type:a.type,content:named(a.content,50000)}
   case 'notify':if(!['customer_update','assignee','group','followers','request_received','solved','sla_breach'].includes(a.kind))invalid('Unknown notification kind');return {type:a.type,kind:a.kind,...(a.recipient_id?{recipient_id:named(a.recipient_id,200)}:{}),...(a.message?{message:named(a.message,10000)}:{})}
   case 'webhook':return {type:a.type,destination_id:named(a.destination_id,200)}
   case 'route':return {type:a.type}
   default:invalid('Unknown workflow action')
  }
 })
}
