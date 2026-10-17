import type {Env} from '../../platform/env'
import {publishActivity} from '../conversations/activity'

/** Only invalidate operator projections after a durable commit; never replay a
 * committed merge or mail operation because a live connection was unavailable. */
export async function publishConversationAction(env:Env,projectId:string,ids:string[],kind:string){
 try{
  const targets=(await env.DB.prepare('SELECT target_id FROM conversation_merges WHERE project_id=? AND source_id IN(SELECT value FROM json_each(?)) AND undone_at IS NULL').bind(projectId,JSON.stringify(ids)).all<{target_id:string}>()).results;
  await Promise.all([...new Set([...ids,...targets.map(row=>row.target_id)])].map(id=>publishActivity(env,projectId,id,kind)));return true
 }
 catch(error){console.error('Committed conversation action could not publish its live refresh',error);return false}
}
