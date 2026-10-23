import {helpScoutShapes} from './helpscout-shapes'
import {freshdeskShapes} from './freshdesk-shapes'
import {object,sourceId,time} from './common'
import type {Vendor} from '../types'

type Shape={type:'string'|'boolean'|'integer'|'id'|'iso'|'unix'|'visibility'|'opaque'|'object'|'array'|'action'|'condition';nullable?:boolean;values?:string[];fields?:Record<string,Shape>;item?:Shape;required?:string[];person?:boolean;reference?:boolean}
const string:Shape={type:'string'},boolean:Shape={type:'boolean'},integer:Shape={type:'integer'},id:Shape={type:'id'},opaque:Shape={type:'opaque'}
const nullable=(shape:Shape):Shape=>({...shape,nullable:true})
const oneOf=(...values:string[]):Shape=>({...string,values})
const array=(item:Shape):Shape=>({type:'array',item})
const record=(fields:Record<string,Shape>,required:string[]=[]):Shape=>({type:'object',fields,required})
const reference:Shape={...id,reference:true}
const configurationConditions=record({all:array({type:'condition'}),any:array({type:'condition'})},['all','any'])
const person=record({id:reference,type:oneOf('contact','user','lead','admin','teammate','team','bot','campaign','system'),name:nullable(string),email:nullable(string),external_id:nullable(string)},['id'])
person.person=true
const tag=record({id,type:oneOf('tag'),name:string},['name'])
const tagList=nullable(record({type:oneOf('list','tag.list'),tags:array(tag),data:array(tag)}))
const channel=record({initial:oneOf('email','messenger')},['initial'])
const via=nullable(record({channel:string,source:nullable(opaque)}))
const zendeskAttachment=record({id,file_name:string,content_type:string,size:integer,content_url:string,url:string,inline:boolean,deleted:boolean,thumbnails:array(opaque),width:nullable(integer),height:nullable(integer),mapped_content_url:nullable(string),malware_scan_result:nullable(string),malware_access_override:boolean},['id','file_name','content_type'])
const intercomAttachment=record({type:string,name:string,url:string,content_type:string,filesize:integer,width:integer,height:integer},['name','content_type'])
const comment=record({id,author_id:reference,public:boolean,body:nullable(string),plain_body:nullable(string),created_at:{type:'iso'},attachments:nullable(array(zendeskAttachment)),metadata:nullable(opaque),via},['id','author_id'])
const source=record({id,type:oneOf('email','messenger'),subject:nullable(string),body:nullable(string),author:person,attachments:nullable(array(intercomAttachment))},['id','author'])
const part=record({id,type:oneOf('conversation_part'),part_type:oneOf('comment','note'),body:nullable(string),created_at:{type:'unix'},updated_at:{type:'unix'},author:person,attachments:nullable(array(intercomAttachment))},['id','author'])
const articleStructure={translated_content:nullable(opaque),section_id:nullable(id),parent_id:nullable(id),tags:nullable(opaque),scheduled_publish_at:nullable(opaque),scheduled_unpublish_at:nullable(opaque),ai_agent_availability:nullable(opaque)}
const contactFields={name:nullable(string),email:nullable(string),external_id:nullable(string),custom_attributes:nullable(opaque),user_fields:nullable(opaque)}
function common(timestamp:'iso'|'unix'){return {id,type:string,kind:string,created_at:{type:timestamp} as Shape,updated_at:{type:timestamp} as Shape}}
/** This finite schema describes understood source structure, including containers
 * read by mappings. Opaque retained fields are explicit leaves, never traversed or
 * guessed from arbitrary text. Missing mapping requirements remain mapper errors. */
export const recordShapes:Record<string,Shape>={
 'zendesk/organization':record({...common('iso'),name:string,external_id:nullable(string),details:nullable(string),notes:nullable(string),domain_names:array(string),organization_fields:opaque,tags:array(string),group_id:nullable(id),shared_tickets:boolean,shared_comments:boolean,ticket_restriction:nullable(string),deleted_at:nullable({type:'iso'}),url:string,children_count:integer},['id','name','created_at','updated_at']),
 'intercom/company':record({...common('unix'),name:string,app_id:string,company_id:string,remote_created_at:{type:'unix'},last_request_at:{type:'unix'},plan:opaque,size:nullable(integer),website:nullable(string),industry:nullable(string),monthly_spend:integer,session_count:integer,user_count:integer,custom_attributes:opaque,tags:opaque,segments:opaque,notes:opaque},['id','name','created_at','updated_at']),
 'intercom/team':record({id,type:oneOf('team'),name:string,admin_ids:array(reference),admin_priority_level:opaque,assignment_limit:integer,distribution_method:string},['id','name']),
 'zendesk/ticket_field':record({...common('iso'),title:string,title_in_portal:string,description:nullable(string),active:boolean,required:boolean,visible_in_portal:boolean,editable_in_portal:boolean,required_in_portal:boolean,agent_can_edit:boolean,regexp_for_validation:nullable(string),default_value:nullable(opaque),tag:nullable(string),custom_field_options:array(record({id,name:string,raw_name:string,value:string,default:boolean},['name','value']))},['id','type','title','updated_at']),
 'zendesk/ticket_form':record({...common('iso'),name:string,display_name:string,raw_name:string,raw_display_name:string,active:boolean,default:boolean,end_user_visible:boolean,in_all_brands:boolean,restricted_brand_ids:array(id),ticket_field_ids:array(id),agent_conditions:array(opaque),end_user_conditions:array(opaque)},['id','name','ticket_field_ids','updated_at']),
 'zendesk/group':record({...common('iso'),name:string,deleted:boolean,default:boolean,description:nullable(string)},['id','name','created_at','updated_at']),
 'zendesk/schedule':record({...common('iso'),name:string,time_zone:string,intervals:array(record({start_time:integer,end_time:integer},['start_time','end_time'])),holidays:array(record({id,name:string,start_date:string,end_date:string},['start_date','end_date']))},['id','name','time_zone','intervals']),
 'zendesk/view':record({...common('iso'),title:string,active:boolean,restriction:nullable(opaque),conditions:configurationConditions,execution:record({sort_by:string,sort_order:string,columns:opaque,group_by:nullable(opaque),group_order:nullable(opaque)})},['id','title','conditions']),
 'zendesk/trigger':record({...common('iso'),title:string,active:boolean,position:integer,conditions:configurationConditions,actions:array({type:'action'})},['id','title','conditions','actions']),
 'zendesk/automation':record({...common('iso'),title:string,active:boolean,position:integer,conditions:configurationConditions,actions:array({type:'action'})},['id','title','conditions','actions']),
 'zendesk/user':{...record({...common('iso'),...contactFields,organization_id:nullable(id),role:oneOf('end-user','agent','admin'),tags:nullable(array(string))},['id']),person:true},
 'zendesk/ticket':record({...common('iso'),subject:nullable(string),requester_id:reference,status:oneOf('new','open','pending','hold','solved','closed'),tags:nullable(array(string)),comments:array(comment),attachments:nullable(opaque),assignee_id:nullable(reference),group_id:nullable(id),custom_fields:array(record({id,value:nullable(opaque)},['id','value'])),via},['requester_id','comments']),
 'zendesk/macro':record({...common('iso'),title:string,restriction:nullable(opaque),actions:array({type:'action'})}),
 'zendesk/article':record({...common('iso'),title:string,body:string,draft:boolean,user_segment_id:nullable(id),user_segment_ids:array(id),...articleStructure}),
 'intercom/contact':{...record({...common('unix'),...contactFields,tags:tagList,companies:record({data:array(record({id,type:string,name:nullable(string)})),url:string,total_count:integer,has_more:boolean})},['id']),person:true},
 'intercom/conversation':record({...common('unix'),title:nullable(string),subject:nullable(string),source,state:oneOf('open','closed','snoozed'),contacts:record({type:oneOf('contact.list'),contacts:array(person)},['type','contacts']),conversation_parts:record({type:oneOf('conversation_part.list'),total_count:integer,conversation_parts:array(part)},['type','conversation_parts']),channel,tags:tagList,admin_assignee_id:nullable(reference),team_assignee_id:nullable(reference)},['source','contacts','conversation_parts','channel']),
 'intercom/macro':record({...common('iso'),name:string,body:nullable(string),body_text:nullable(string),visible_to:oneOf('everyone'),available_on:array(string)}),
 'intercom/article':record({...common('unix'),title:string,body:nullable(string),body_markdown:nullable(string),state:oneOf('draft','published'),audience:nullable(opaque),audience_rules:nullable(opaque),...articleStructure}),
 'zendesk/tag-name':record({...common('iso'),name:string}),
 'intercom/tag-name':record({...common('unix'),name:string}),
 // Only empty pagination metadata has no uninterpreted content. Nonempty pages
 // are retained/reported as unsupported envelope content, including cursor trees.
 'intercom/$envelope':record({type:string,kind:string,total_count:integer,pages:nullable(record({}))})
}
Object.assign(recordShapes,helpScoutShapes({record,array,nullable,string,integer,id,reference,opaque,boolean}),freshdeskShapes({record,array,nullable,string,integer,id,reference,opaque,boolean}))
for(const [plural,singular] of Object.entries({teams:'team',organizations:'organization',conversations:'conversation',customers:'contact',tags:'tag'}))recordShapes[`helpscout/inbox-list:${plural}`]=record({_embedded:record({[plural]:array(recordShapes[`helpscout/${singular}`])}),page:recordShapes['helpscout/$page'].fields!.value,_links:recordShapes['helpscout/$links'].fields!.value})
for(const [plural,singular] of Object.entries({collections:'collection',categories:'category',articles:'article-ref'}))recordShapes[`helpscout/docs-list:${plural}`]=record({page:integer,pages:integer,count:integer,items:array(recordShapes[`helpscout/${singular}`])})
for(const [key,schema] of Object.entries(recordShapes)){const kind=key.split('/')[1];if(!key.startsWith('helpscout/')&&!key.startsWith('freshdesk/')&&!kind.startsWith('$')){schema.fields!.type=oneOf(kind);schema.fields!.kind=oneOf(kind)}}
// The wrapper determines Zendesk record kind. Ticket type is a nullable
// business classification, not the Intercom document discriminator.
recordShapes['zendesk/ticket_field'].fields!.type=string
recordShapes['zendesk/ticket'].fields!.type=nullable(oneOf('problem','incident','question','task'))
export interface ShapeIssue {code:'unsupported_source_field'|'malformed_source_field'|'opaque_source_field'|'source_shape_limit';path:string;reason:string}
/** uninterpreted: every retained value the schema does not read, for whole-value erasure. */
export interface ShapeAudit {complete:boolean;issues:ShapeIssue[];people:Record<string,any>[];references:unknown[];uninterpreted:unknown[];nodes:number;exhausted?:string}
const escape=(value:string)=>value.replace(/~/g,'~0').replace(/\//g,'~1')
export const SHAPE_NODE_LIMIT=4096
/** Depth is bounded by the static, acyclic schema; work and diagnostics also have
 * explicit per-record caps. Unknown/opaque subtrees are classified at their root. */
export function auditShape(vendor:Vendor,kind:string,payload:unknown):ShapeAudit {
 const result:ShapeAudit={complete:true,issues:[],people:[],references:[],uninterpreted:[],nodes:0},shape=recordShapes[`${vendor}/${vendor==='helpscout'&&kind.startsWith('metadata:')?(kind.endsWith('/page')?'$page':kind.endsWith('/_links')?'$links':/\/(pages|count)$/.test(kind)?'$count':kind):kind}`]
 let nodes=0,stopped=false
 const issue=(code:ShapeIssue['code'],path:string,reason:string)=>{result.complete=false;if(result.issues.length<128)result.issues.push({code,path,reason});else if(result.issues.length===128)result.issues.push({code:'source_shape_limit',path,reason:'field_diagnostics_truncated'})}
 const count=(path:string)=>{result.nodes=++nodes;if(nodes<=SHAPE_NODE_LIMIT)return true;result.complete=false;result.exhausted=path;stopped=true;return false}
 if(!shape){issue('unsupported_source_field','','record_kind_not_understood');result.uninterpreted.push(payload);return result}
 function visit(value:unknown,schema:Shape,path:string){
  if(stopped)return
  if(!count(path))return
  if(value===null&&schema.nullable)return
  if(schema.type==='opaque'){issue('opaque_source_field',path,'retained_value_not_identity_indexed');result.uninterpreted.push(value);return}
  if(schema.type==='condition'){
   const field=object(value)?value.field:undefined
   const valueShape:Shape=['group_id','assignee_id','requester_id'].includes(field)?reference:['status','priority','tags'].includes(field)?string:typeof field==='string'&&field.startsWith('hours_since_')?(typeof (value as any).value==='number'?integer:string):opaque
   visit(value,record({field:string,operator:string,value:valueShape},['field','operator','value']),path);return
  }
  if(schema.type==='action'){
   const field=object(value)?value.field:undefined,valueShape:Shape=['comment_value','comment_value_html','priority','status','current_tags','remove_tags'].includes(field)?string:field==='group_id'?reference:field==='comment_mode_is_public'?{type:'visibility'}:opaque
   visit(value,record({field:string,value:valueShape},['field','value']),path);return
  }
  if(schema.type==='object'){
   if(!object(value)){issue('malformed_source_field',path,'expected_object');result.uninterpreted.push(value);return}
   if(schema.person)result.people.push(value)
   for(const key of schema.required??[])if(!Object.hasOwn(value,key))issue('malformed_source_field',`${path}/${escape(key)}`,'required_structural_field_missing')
   for(const key of Object.keys(value)){const child=Object.hasOwn(schema.fields!,key)?schema.fields![key]:undefined,next=`${path}/${escape(key)}`;if(child)visit(value[key],child,next);else {if(!count(next))break;issue('unsupported_source_field',next,'field_not_understood');result.uninterpreted.push(value[key])}if(stopped)break}
   return
  }
  if(schema.type==='array'){if(!Array.isArray(value)){issue('malformed_source_field',path,'expected_array');result.uninterpreted.push(value);return}for(let i=0;i<value.length&&!stopped;i++)visit(value[i],schema.item!,`${path}/${i}`);return}
  let valid=false
  if(schema.type==='id'){try{sourceId(value,vendor);valid=true}catch{}}
  else if(schema.type==='iso'||schema.type==='unix'){try{time(value,schema.type);valid=true}catch{}}
  else if(schema.type==='integer')valid=typeof value==='number'&&Number.isSafeInteger(value)&&value>=0
  else if(schema.type==='visibility')valid=typeof value==='boolean'||value==='true'||value==='false'
  else valid=typeof value===schema.type
  if(valid&&schema.values&&!schema.values.includes(value as string)){issue('malformed_source_field',path,'unsupported_structural_value');result.uninterpreted.push(value)}
  else if(!valid){issue('malformed_source_field',path,`expected_${schema.type}`);result.uninterpreted.push(value)}
  else if(schema.reference)result.references.push(value)
 }
 visit(payload,shape,'');if(vendor==='helpscout'&&kind==='contact'&&object(payload)&&Array.isArray(payload._embedded?.emails))for(const entry of payload._embedded.emails)if(object(entry)&&typeof entry.value==='string')result.people.push({id:payload.id,email:entry.value})
 // A Freshdesk contact's other addresses are aliases of the same person for erasure.
 if(vendor==='freshdesk'&&object(payload)&&(kind==='contact'&&Array.isArray(payload.other_emails)||kind==='agent'&&object(payload.contact)))for(const email of kind==='contact'?payload.other_emails:[payload.contact.email])if(typeof email==='string')result.people.push({id:payload.id,email})
 return result
}
export function shapeReason(issue:ShapeIssue){const path=issue.code==='unsupported_source_field'&&/^\/[^/]+$/.test(issue.path)?issue.path.slice(1):issue.path;return `${issue.code}:${path}${issue.code==='unsupported_source_field'?'':`:${issue.reason}`}`}
