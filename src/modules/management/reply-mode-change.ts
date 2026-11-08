import type {AuditSource} from '../audit/record'
import {auditStatement} from '../audit/record'
import {replyMode,type AiReplyMode} from '../ai-support/reply-mode'
import type {SettingsGuard} from './settings-save'

/** A mode change also records when it happened (`ai_reply_mode_since`, the message clock), so automatic
 * replies answer only visitor turns written after the latest switch: a turn from a draft or off period is
 * never answered later. Saving without a change keeps both keys as they are. */
export function withReplyModeSince(old:any,patch:Record<string,unknown>,now:number){
 return 'ai_reply_mode' in patch&&patch.ai_reply_mode!==replyMode(old)?{...patch,ai_reply_mode_since:now}:patch
}

/** Batched with the settings write that changes a workspace's AI reply mode: one security-log
 * event, and every queued or running generation the new mode refuses becomes cancelled (terminal:
 * never claimed, never re-sent by recovery, never admitted), so a later switch back releases nothing. */
export function replyModeChange(db:D1Database,input:{projectId:string;actorId:string;source:AuditSource},from:AiReplyMode,to:AiReplyMode,guard?:SettingsGuard):D1PreparedStatement[]{
 if(from===to)return []
 return [
  auditStatement(db,{projectId:input.projectId,category:'data',action:'ai.reply_mode_changed',actor:{type:'user',id:input.actorId},source:input.source,target:{type:'project',id:input.projectId},detail:{from,to}},Date.now(),guard),
  ...(to==='auto'?[]:[db.prepare(`UPDATE ai_generations SET state='cancelled',error=?,updated_at=? WHERE project_id=? AND state IN ('queued','running') AND (kind='reply' OR ?)${guard?` AND ${guard.sql}`:''}`).bind(`AI reply mode changed to ${to}`,new Date().toISOString(),input.projectId,to==='off'?1:0,...(guard?.params??[]))]),
 ]
}
