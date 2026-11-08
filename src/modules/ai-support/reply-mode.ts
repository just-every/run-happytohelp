import {HTTPException} from 'hono/http-exception'

/** A workspace's AI reply mode, `project_settings.settings_json.ai_reply_mode`.
 * `auto`: AI replies reach customers (absent means auto). `draft`: AI writes only
 * drafts for the team; no AI-authored message reaches a customer. `off`: no AI generation. */
export const AI_REPLY_MODES=['auto','draft','off'] as const
export type AiReplyMode=typeof AI_REPLY_MODES[number]

/** The three exact lowercase values; anything else is refused before anything is written. */
export function parseReplyMode(value:unknown):AiReplyMode{
 if(typeof value==='string'&&(AI_REPLY_MODES as readonly string[]).includes(value))return value as AiReplyMode
 throw new HTTPException(400,{message:'AI replies must be auto, draft or off'})
}

/** The effective mode of a workspace settings object. */
export const replyMode=(settings:any):AiReplyMode=>settings?.ai_reply_mode??'auto'

/** The effective mode of the project named by the SQL expression, read inside the guarded statement. */
export const replyModeSql=(projectIdExpr:string)=>`COALESCE((SELECT json_extract(settings_json,'$.ai_reply_mode') FROM project_settings WHERE project_id=${projectIdExpr}),'auto')`
/** AI may write to a customer (replies, proactive help, AI-authored mail). */
export const customerAiSql=(projectIdExpr:string)=>`${replyModeSql(projectIdExpr)}='auto'`
/** An automatic reply may answer the visitor turn named by the SQL expression (its created_at): only one
 * written since the workspace's latest mode change, so a turn from a draft or off period is never answered later. */
export const answerableTurnSql=(projectIdExpr:string,createdAtExpr:string)=>`${createdAtExpr}>=COALESCE((SELECT json_extract(settings_json,'$.ai_reply_mode_since') FROM project_settings WHERE project_id=${projectIdExpr}),0)`
/** AI may generate at all (drafts for the team included). */
export const aiGenerationSql=(projectIdExpr:string)=>`${replyModeSql(projectIdExpr)}<>'off'`
/** A generation of the kind named by the SQL expression may run: a reply only in auto, anything else unless off. */
export const generationKindSql=(projectIdExpr:string,kindExpr:string)=>`(${kindExpr}<>'reply' OR ${customerAiSql(projectIdExpr)}) AND ${aiGenerationSql(projectIdExpr)}`

/** The current mode of one workspace. */
export async function workspaceReplyMode(db:D1Database,projectId:string):Promise<AiReplyMode>{
 const row=await db.prepare(`SELECT ${replyModeSql('?')} mode`).bind(projectId).first<{mode:AiReplyMode}>()
 return row?.mode??'auto'
}

/** Whether a mode allows a generation kind: a customer reply only in auto, a draft unless off. */
export const allowsGeneration=(mode:AiReplyMode,kind:string)=>mode!=='off'&&(kind!=='reply'||mode==='auto')

/** An explicit AI request the workspace's mode refuses. */
export class AiReplyModeRefused extends Error{
 readonly status=409
 readonly code:'AI_REPLY_MODE_DRAFT'|'AI_REPLY_MODE_OFF'
 constructor(mode:AiReplyMode){
  const code=mode==='off'?'AI_REPLY_MODE_OFF':'AI_REPLY_MODE_DRAFT'
  super(mode==='off'?`${code}: AI is off for this workspace`:`${code}: AI writes drafts only in this workspace; send the reply yourself`)
  this.code=code
 }
}
