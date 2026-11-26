import type {Actor,Env} from '../../platform/env'
import {publishActivity} from '../conversations/activity'
import {activeSourceProjectSql} from '../knowledge/public-sources'
import {postAwayReply} from '../management/away-reply'
import {workflowEnvironment} from '../workflows/clock'
import {customerAiSql} from './reply-mode'
import type {GenerationEffects} from './generation-effects'
import type {Generation} from './repository'

export const starterReplyErrorSql=(row:string)=>`
 ${row}.kind='reply' AND ${row}.state='uncertain' AND json_extract(${row}.actor_json,'$.role')='contact'
 AND ${row}.ai_id=(SELECT json_extract(settings_json,'$.starter_ai.id') FROM project_settings WHERE project_id=${row}.project_id)
`

/** Return the still-waiting turn to the unassigned team queue. Redelivery can
 * finish the away reply after an interruption, without re-running the model. */
export async function returnFailedStarterReply(env:Env,row:Generation,effects:GenerationEffects) {
 if(row.kind!=='reply')return
 const released=await env.DB.prepare(`UPDATE conversation_ai SET ai_id=NULL
  WHERE conversation_id=? AND (ai_id=? OR ai_id IS NULL) AND EXISTS(
   SELECT 1 FROM ai_generations g
   JOIN conversations c ON c.id=g.conversation_id AND c.project_id=g.project_id
   JOIN ai_profiles a ON a.id=g.ai_id AND a.project_id=g.project_id
   WHERE g.id=? AND g.project_id=? AND c.id=conversation_ai.conversation_id
   AND ${starterReplyErrorSql('g')} AND ${activeSourceProjectSql('c.project_id')} AND ${customerAiSql('c.project_id')}
   AND c.assigned_to IS NULL AND c.resolved_at IS NULL AND c.revision=g.source_revision
   AND c.last_message_id=g.source_last_message_id AND a.model=json_extract(g.ai_profile_json,'$.model')
   AND a.prompt=json_extract(g.ai_profile_json,'$.prompt')
   AND NOT EXISTS(SELECT 1 FROM ai_generations newer WHERE newer.project_id=g.project_id
    AND newer.conversation_id=g.conversation_id AND newer.kind='reply' AND newer.rowid>g.rowid)
  )`).bind(row.conversation_id,row.ai_id,row.id,row.project_id).run()
 if(!released.meta.changes)return
 const message=await env.DB.prepare('SELECT * FROM messages WHERE id=? AND project_id=? AND conversation_id=?')
  .bind(row.source_last_message_id,row.project_id,row.conversation_id).first<Record<string,unknown>>()
 const actor=JSON.parse(row.actor_json) as Actor
 const away=message&&await postAwayReply(await workflowEnvironment(env),message,actor,{teamOnly:true})
 await Promise.all([
  effects.publishSuggestions(env,row.project_id,row.conversation_id),
  effects.emit(env,row,{type:'settings',payload:{ai_id:null}}),
  publishActivity(env,row.project_id,row.conversation_id,'assignment'),
  ...(away?[env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(row.conversation_id))
   .fetch('https://conversation.internal/broadcast',{method:'POST'})]:[]),
 ])
}
