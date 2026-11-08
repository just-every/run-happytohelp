import {ticketScopeSql} from '../access/ticket-scope'
import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'

/** Apply this only to writes and operator queues, never to contact read scope. */
export const writableConversationSql=(alias='c')=>`NOT EXISTS(SELECT 1 FROM conversation_merges active_merge WHERE active_merge.project_id=${alias}.project_id AND active_merge.source_id=${alias}.id AND active_merge.undone_at IS NULL)`
export async function mergedAlias(env:Env,projectId:string,id:string){
 return env.DB.prepare('SELECT id merge_id,target_id FROM conversation_merges WHERE project_id=? AND source_id=? AND undone_at IS NULL').bind(projectId,id).first<{merge_id:string;target_id:string}>()
}
/** Native readers may disclose a survivor only while it remains visible. */
export async function operatorMergeTarget(env:Env,projectId:string,id:string,userId:string){
 const row=await env.DB.prepare(`SELECT c.id FROM conversation_merges m JOIN conversations c ON c.id=m.target_id AND c.project_id=m.project_id WHERE m.project_id=? AND m.source_id=? AND m.undone_at IS NULL AND ${ticketScopeSql('?')}`).bind(projectId,id,userId).first<{id:string}>()
 return row?.id??null
}
export async function assertWritableConversation(env:Env,projectId:string,id:string){
 if(await mergedAlias(env,projectId,id))throw new HTTPException(409,{message:'This ticket was merged. Open its surviving ticket before writing.'})
}
/** A redirect is safe only when the same current widget contact owns both rows.
 * The client must reload the survivor's frontier before attempting a write. */
export async function customerMergeTarget(env:Env,projectId:string,id:string,contactId:string){
 const row=await env.DB.prepare(`SELECT t.id FROM conversation_merges m JOIN conversations s ON s.id=m.source_id AND s.project_id=m.project_id JOIN conversations t ON t.id=m.target_id AND t.project_id=m.project_id WHERE m.project_id=? AND m.source_id=? AND m.undone_at IS NULL AND s.contact_id=? AND t.contact_id=?`).bind(projectId,id,contactId,contactId).first<{id:string}>()
 return row?.id??null
}
/** CALLER MUST enforce current operator membership. Never call for widgets,
 * customer attachment reads, notifications or customer transcript exports. */
export async function operatorThreadIds(env:Env,projectId:string,id:string,userId:string){
 const alias=await mergedAlias(env,projectId,id),target=alias?.target_id??id
 // The survivor, then the sources merged into it, each read through its own key.
 const rows=await env.DB.prepare(`SELECT id FROM (SELECT c.id,0 source,NULL merged_at,NULL merge_id FROM conversations c WHERE c.id=? AND c.project_id=? AND ${ticketScopeSql('?')}
  UNION ALL SELECT c.id,1,m.created_at,m.id FROM conversation_merges m CROSS JOIN conversations c ON c.id=m.source_id AND c.project_id=m.project_id WHERE m.project_id=? AND m.target_id=? AND m.undone_at IS NULL AND ${ticketScopeSql('?')}) ORDER BY source,merged_at,merge_id`).bind(target,projectId,userId,projectId,target,userId).all<{id:string}>()
 return rows.results.map(row=>row.id)
}
export async function mergeHistory(env:Env,projectId:string,id:string,userId:string){
 return (await env.DB.prepare(`SELECT * FROM conversation_merges m WHERE project_id=? AND (source_id=? OR target_id=?) AND EXISTS(SELECT 1 FROM conversations c WHERE c.project_id=m.project_id AND c.id=m.source_id AND ${ticketScopeSql('?')}) AND EXISTS(SELECT 1 FROM conversations c WHERE c.project_id=m.project_id AND c.id=m.target_id AND ${ticketScopeSql('?')}) ORDER BY created_at DESC,id LIMIT 100`).bind(projectId,id,id,userId,userId).all()).results
}
