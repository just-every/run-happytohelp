import type {Env} from '../../platform/env'
import {starterReplyErrorSql} from './reply-failure'
export const suggestionGenerationSql=(row:string)=>`(${row}.kind='suggestions' OR (${starterReplyErrorSql(row)}))`
export async function suggestionState(env:Env,projectId:string,conversationId:string){
 const row=await env.DB.prepare(`SELECT g.rowid sequence,g.* FROM ai_generations g WHERE g.project_id=? AND g.conversation_id=? AND ${suggestionGenerationSql('g')} ORDER BY g.rowid DESC LIMIT 1`).bind(projectId,conversationId).first<any>()
 return presentSuggestions(row)
}
export function presentSuggestions(row:any){
 if(!row)return null
 const stored=JSON.parse(row.output_json||'{}'),options=JSON.parse(row.options_json||'{}'),loading=['queued','running'].includes(row.state)
 return {...(row.state==='completed'?stored.result||{}:{}),generation_id:row.id,generation_sequence:row.sequence,client_request_id:options.client_request_id||row.id,display_request_version:options.display_request_version??null,loading,loading_message:loading?options.loading_message||'':'',status:loading?'loading':row.state==='completed'?'complete':row.state==='superseded'?'superseded':'error',error:['failed','uncertain','cancelled'].includes(row.state)?row.error||row.state:'',tool_response:row.state==='completed'&&options.tool?stored.result?.response||'':'',generation_deadline_at:new Date(new Date(row.created_at).getTime()+180000).toISOString()}
}
export async function publishSuggestions(env:Env,projectId:string,conversationId:string){
 const suggestions=await suggestionState(env,projectId,conversationId)
 await env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(conversationId)).fetch('https://conversation.internal/event',{method:'POST',body:JSON.stringify({type:'settings',operatorOnly:true,conversationId,conversation_id:conversationId,payload:{conversation_id:conversationId,metadata:{suggestions}}})})
 return suggestions
}
