import type {Env} from '../../platform/env'
import {HTTPException} from 'hono/http-exception'
import {ToolRefusal,type ToolDefinition,type ToolContext,type JsonSchemaObject} from '../../vendor/agent-base/modules/agent-door/index.ts'
import {actorFor,articleRead,contextRead,conversationRead,jobRead,operationRead,readClasses,redacted} from './read.ts'
import {currentGrant} from './local-credentials.ts'
import {readReport} from '../../modules/reports/read'
import {reportRange} from '../../modules/reports/calendar'
import {mutateTicket} from '../../modules/tickets/mutate'
import {createNote} from '../../modules/collaboration/notes'
import {agentAuthority,nativeAgentAuthority} from '../../platform/agent-authority'
import {savedReplies,savedReply,projectSettings,ownDraft,staffProject} from './support-reads'
import {saveReplyDraft} from '../../modules/conversations/drafts'
import {contactWritable} from '../../platform/contact-state'
const string={type:'string',minLength:1,maxLength:200},text={type:'string',minLength:1,maxLength:50000}
const schema=(properties:Record<string,unknown>={},required=Object.keys(properties)):JsonSchemaObject=>({type:'object',properties:properties as any,required,additionalProperties:false})
const record={type:'object'},array={type:'array',items:record}
const readOutputs:Record<string,Record<string,unknown>>={
 'conversations.list':{conversations:{type:'array',items:{type:'object',properties:{id:string,subject:{type:'string'},revision:{type:'integer'},ticket_version:{type:'integer'},note_count:{type:'integer'}},required:['id','subject','revision','ticket_version','note_count']}}},
 'conversations.read':{ticket:record,messages:array,attachments:array,activity:array,jobs:array},
 'saved_replies.list':{data:array,sort:{type:'string'},direction:{type:'string'},pagination:record},'saved_replies.read':{reply:record},'settings.read':{settings:record},'drafts.read':{draft:{type:['object','null']}},
 'context.read':{context:record},'articles.list':{articles:array},'articles.read':{article:record},'jobs.read':{job:record},'operations.read':{operation:record},'reports.read':{report:record},'people.read':{people:array},'workflows.read':{workflows:array},'ai.read':{assistants:array},'integrations.read':{email:record},
}
const output=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false})
export const notTools=[{clauses:['NATIVE-001','IDENTITY-002'],reason:'installation' as const},{clauses:['MOVE-IN-001','MIGRATION-001'],reason:'import-door' as const},{clauses:['DELEGATION-001','PUSH-001'],reason:'connector' as const}]
export function happyTools(env:Env):ToolDefinition[]{
 const read=(name:string,title:string,clauses:string[],input:JsonSchemaObject,run:(args:any,ctx:ToolContext)=>Promise<any>):ToolDefinition=>{
  const prepared=new WeakMap<Record<string,unknown>,{person:string;record:unknown}>()
  return {
  name:'happytohelp.'+name,title,description:title+'. Reads current native project authority and redacted records.',scope:'happytohelp.'+name,readOnly:true,inputSchema:input,outputSchema:output(readOutputs[name]),classes:['conversations.list','conversations.read','context.read','articles.list','articles.read','reports.read','saved_replies.list','saved_replies.read','settings.read','drafts.read'].includes(name)?['standard','sensitive']:['standard'],clauses,untrusted:true,
  async classify(args,ctx){const record=await run(args,ctx);prepared.set(args,{person:ctx.person.id,record});return ['conversations.list','conversations.read','context.read','articles.list','articles.read','reports.read','saved_replies.list','saved_replies.read','settings.read','drafts.read'].includes(name)?readClasses(record):[{class:'standard',facts:{measure:1}}]},
  async target(args,ctx){
   if(name==='context.read'){const {ticket}=await conversationRead(env,ctx,String(args.id));return {kind:'conversation',id:ticket.id}}
   const field:Record<string,string>={'conversations.read':'ticket','articles.read':'article','jobs.read':'job','operations.read':'operation'}
   if(!field[name])return null
   const value=await run(args,ctx)
   return {kind:({'conversations.read':'conversation','articles.read':'article','jobs.read':'job','operations.read':'operation'} as Record<string,string>)[name],id:value[field[name]].id}
  },
  async run(args,ctx){const saved=prepared.get(args),current=await run(args,ctx);if(!saved||saved.person!==ctx.person.id||JSON.stringify(saved.record)!==JSON.stringify(current))throw new ToolRefusal('native_evidence_changed');return {result:current}},
  }
 }
 const projectRead=async(ctx:ToolContext)=>{if(ctx.clientId?.startsWith('edition:'))throw new ToolRefusal('insufficient_scope');return actorFor(env,ctx)}
 const tools:ToolDefinition[]=[
  read('conversations.list','Find support tickets',['CONVERSATION-001','IDENTITY-001'],schema({q:{type:'string',maxLength:200}},[]),async(a,ctx)=>{
   const actor=await actorFor(env,ctx)
   let ids=(await env.DB.prepare('SELECT id FROM conversations WHERE project_id=? AND instr(lower(subject),lower(?))>0 ORDER BY updated_at DESC,id LIMIT 100').bind(actor.projectId,a.q??'').all<{id:string}>()).results.map(row=>row.id)
   if(ctx.clientId?.startsWith('edition:')){const g=await currentGrant(env,ctx.clientId.slice(8));ids=ids.filter(id=>g&&JSON.parse(g.targets).includes(`projects/${actor.projectId}/conversations/${id}`))}
   const conversations=[]
   for(const id of ids){const {ticket}=await conversationRead(env,ctx,id);conversations.push({id:ticket.id,subject:ticket.subject,revision:ticket.revision,ticket_version:ticket.ticket_version,last_message_id:ticket.last_message_id,note_count:(await env.DB.prepare('SELECT count(*) total FROM conversation_notes WHERE conversation_id=?').bind(id).first<{total:number}>())!.total,assigned_to:ticket.assigned_to,status:ticket.status_category})}
   return {conversations}
  }),
  read('conversations.read','Read a support transcript',['CONVERSATION-001','IDENTITY-001'],schema({id:string}),async(a,c)=>conversationRead(env,c,a.id)),
  read('saved_replies.list','Find native saved replies',['MACRO-001','IDENTITY-001'],schema({q:{type:'string',maxLength:500},page:{type:'integer',minimum:1,maximum:1000000},limit:{type:'integer',minimum:1,maximum:100}},[]),(a,c)=>savedReplies(env,c,a)),
  read('saved_replies.read','Read a native saved reply',['MACRO-001','IDENTITY-001'],schema({id:string}),(a,c)=>savedReply(env,c,a.id)),
  read('settings.read','Read nonsecret native workspace Settings',['IDENTITY-001'],schema({project_id:string}),(a,c)=>projectSettings(env,c,a.project_id)),
  read('drafts.read','Read your native reply draft',['CONVERSATION-001','IDENTITY-001'],schema({id:string}),(a,c)=>ownDraft(env,c,a.id)),
  read('context.read','Read permitted customer context',['CONTEXT-001','IDENTITY-001'],schema({id:string}),async(a,c)=>({context:await contextRead(env,c,a.id)})),
  read('articles.list','Find permitted knowledge articles',['KNOWLEDGE-001','ACCESS-001'],schema({q:{type:'string',maxLength:200}},[]),async(a,ctx)=>{
   const actor=await actorFor(env,ctx,'knowledge.read'),rows=await env.DB.prepare('SELECT id FROM knowledge_articles WHERE project_id=? AND instr(lower(title),lower(?))>0 ORDER BY id LIMIT 100').bind(actor.projectId,a.q??'').all<{id:string}>(),articles=[]
   for(const row of rows.results){try{const article:any=await articleRead(env,ctx,row.id);articles.push({id:article.id,title:article.title,status:article.status,source_revision:article.source_revision})}catch(error){if(!(error instanceof ToolRefusal))throw error}}
   return {articles}
  }),
  read('articles.read','Read selected knowledge',['KNOWLEDGE-001','ACCESS-001'],schema({id:string}),async(a,c)=>({article:await articleRead(env,c,a.id)})),
  read('jobs.read','Read connector work without asserting recovery',['DELEGATION-001','PUSH-001'],schema({id:string}),async(a,c)=>({job:await jobRead(env,c,a.id)})),
  read('operations.read','Read attributed native work',['AGENT-002'],schema({id:string}),async(a,c)=>({operation:await operationRead(env,c,a.id)})),
  read('reports.read','Read native workspace report',['REPORTS-001'],schema({start:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},end:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}}),async(a,ctx)=>{
   await projectRead(ctx);const actor=await actorFor(env,ctx,'reports.view'),settings=await env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(actor.projectId).first<{settings_json:string}>(),timezone=JSON.parse(settings?.settings_json??'{}').timezone??'UTC'
   return redacted({report:await readReport(env,actor.projectId,reportRange({period:'custom',start:a.start,end:a.end},timezone))})
  }),
  read('people.read','Read customer identities',['IDENTITY-001','ACCESS-001'],schema(),async(_,ctx)=>{const actor=await projectRead(ctx);return {people:(await env.DB.prepare(`SELECT id,name,email FROM contacts WHERE project_id=? AND ${contactWritable} ORDER BY id LIMIT 100`).bind(actor.projectId).all()).results}}),
  read('workflows.read','Read current routing rules',['AUTOMATION-001','AUTOMATION-002'],schema(),async(_,ctx)=>{const actor=await projectRead(ctx);return redacted({workflows:(await env.DB.prepare('SELECT id,name,state,updated_at FROM workflow_rules WHERE project_id=? ORDER BY id').bind(actor.projectId).all()).results})}),
  read('ai.read','Read configured support assistants',['AI-001','AGENT-002'],schema(),async(_,ctx)=>{const actor=await projectRead(ctx);return {assistants:(await env.DB.prepare('SELECT id,name,model,is_enabled FROM ai_profiles WHERE project_id=? ORDER BY id').bind(actor.projectId).all()).results}}),
  read('integrations.read','Read connection readiness without credentials',['CONNECTIONS-001','INTEGRATION-001'],schema(),async(_,ctx)=>{const actor=await projectRead(ctx);return {email:(await env.DB.prepare('SELECT is_enabled FROM email_settings WHERE project_id=?').bind(actor.projectId).first())??{is_enabled:0}}}),
 ]
 const mutation=(name:string,title:string,clauses:string[],input:JsonSchemaObject,permission:'conversations.manage'|'conversations.notes'|'conversations.reply',effect:(args:any,ctx:ToolContext,actor:any,authority:any)=>Promise<any>):ToolDefinition=>({
  name:'happytohelp.'+name,title,description:title+' through the native transaction; current role and source revision remain authoritative.',scope:'happytohelp.'+name,readOnly:false,inputSchema:input,outputSchema:output({[name==='conversations.note'?'note':name==='conversations.draft'?'draft':'ticket']:record,operation:string}),classes:['standard'],clauses,
  async classify(args,ctx){await actorFor(env,ctx,permission);await conversationRead(env,ctx,String(args.id));return [{class:'standard',facts:{measure:1}}]},
  async target(args,ctx){await actorFor(env,ctx,permission);const {ticket}=await conversationRead(env,ctx,String(args.id));return {kind:'conversation',id:ticket.id}},
  revision:async(args,ctx)=>{const {ticket}=await conversationRead(env,ctx,String(args.id));return ticket.ticket_version},
  async summary(args,ctx){
   const {ticket}=await conversationRead(env,ctx,String(args.id)),items=[title]
   if(name==='conversations.draft'){items.push(String(args.content))}
   else if(name==='conversations.note'){
    items.push(String(args.content))
    if(Array.isArray(args.media_ids))for(const id of args.media_ids){
     const media=await env.DB.prepare('SELECT filename FROM media WHERE id=? AND conversation_id=? AND project_id=? AND uploaded_by=? AND message_id IS NULL').bind(id,ticket.id,ticket.project_id,ctx.person.id).first<{filename:string}>()
     if(!media)throw new ToolRefusal('not_found')
     items.push('Attachment: '+media.filename)
    }
   }else if(name==='conversations.assign'){
    const assignee=args.user_id===null?null:await env.DB.prepare('SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=? AND m.user_id=?').bind(ticket.project_id,args.user_id).first<{name:string}>()
    if(args.user_id!==null&&!assignee)throw new ToolRefusal('not_found')
    items.push(assignee?'Assign to '+assignee.name:'Remove the current assignment')
   }else{
    if(args.subject!==undefined)items.push('Subject: '+String(args.subject))
    if(args.priority!==undefined)items.push('Priority: '+String(args.priority))
   }
   return {target:{id:ticket.id,name:ticket.subject||'Support ticket'},items}
  },
  async run(args,ctx){
   if(ctx.clientId?.startsWith('edition:'))throw new ToolRefusal('insufficient_scope')
   const actor=await actorFor(env,ctx,permission),authority=await agentAuthority(env,actor,ctx,'happytohelp.'+name,permission)
   let result:any
   try{result=await effect(args,ctx,actor,authority)}catch(error){
    if(error instanceof HTTPException){
     const codes:Record<number,string>={400:'invalid_arguments',403:'permission_denied',404:'not_found',409:'revision_conflict'}
     if(codes[error.status])throw new ToolRefusal(codes[error.status])
    }
    throw error
   }
   const target=String(args.id),operation=authority[nativeAgentAuthority].operationId
   const uri=`happytohelp://projects/${actor.projectId}/conversations/${target}`
   ctx.emit('conversation.changed',uri,{operation})
   return {result:{...result,operation},resources:[{uri,name:'Support ticket'},{uri:`happytohelp://projects/${actor.projectId}/operations/${operation}`,name:'Native operation'}]}
  },
 })
 tools.push(
  mutation('conversations.draft','Save an internal reply draft',['CONVERSATION-001','IDENTITY-001'],schema({id:string,content:text,draft_id:{type:['string','null'],maxLength:200},revision:{type:'integer',minimum:0},last_message_id:{type:['string','null'],maxLength:200}}),'conversations.reply',async(a,ctx,actor,authority)=>{await staffProject(env,ctx);return {draft:await saveReplyDraft(env,actor,a.id,{content:a.content,draft_id:a.draft_id,revision:a.revision,last_message_id:a.last_message_id},authority)}}),
  mutation('conversations.update','Update a support ticket',['CONVERSATION-001','QUEUE-001'],schema({id:string,version:{type:'integer',minimum:0},subject:{type:'string',maxLength:500},priority:{enum:['low','normal','high','urgent']}},['id','version']), 'conversations.manage',async(a,_ctx,actor,authority)=>({ticket:await mutateTicket(env,actor,a.id,{expected_ticket_version:a.version,...(a.subject===undefined?{}:{subject:a.subject}),...(a.priority===undefined?{}:{priority:a.priority})},{...authority,source:'api'})})),
  mutation('conversations.assign','Assign a support ticket',['CONVERSATION-001','QUEUE-001'],schema({id:string,version:{type:'integer',minimum:0},user_id:{type:['string','null']}},['id','version','user_id']),'conversations.manage',async(a,_ctx,actor,authority)=>({ticket:await mutateTicket(env,actor,a.id,{expected_ticket_version:a.version,agent_id:a.user_id},{...authority,source:'api'})})),
  mutation('conversations.note','Add a private internal note',['CONVERSATION-001'],schema({id:string,content:text,media_ids:{type:'array',items:string,maxItems:20}},['id','content']),'conversations.notes',async(a,_ctx,actor,authority)=>({note:await createNote(env,actor,a.id,{content:a.content,media_ids:a.media_ids},{...authority,source:'api'})})),
 )
 return tools.sort((a,b)=>a.name.localeCompare(b.name))
}
