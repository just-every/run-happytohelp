import {aiGenerationSql,customerAiSql,type AiReplyMode} from '../ai-support/reply-mode'

/** Proactive help (monitoring) writes to the visitor, so it runs only in auto; profiles for the team run unless AI is off. */
export const contextJobAllowed=(mode:AiReplyMode,kind:string)=>kind==='monitoring'?mode==='auto':mode!=='off'
/** The same rule inside a statement, for the project named by the SQL expression. */
export const contextJobAllowedSql=(projectIdExpr:string,kind:string)=>kind==='monitoring'?customerAiSql(projectIdExpr):aiGenerationSql(projectIdExpr)
