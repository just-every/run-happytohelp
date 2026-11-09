import {customerAiSql} from '../ai-support/reply-mode'

/** A visitor has written in conversation `c` (alias) since its assistant last did: a message with a visitor authorship
 * row, not moved in, above the assistant's latest revision. inbox_visitor_waiting (migration 314) holds exactly these
 * conversations, kept current by triggers. */
export const visitorWaitingSql=(c:string)=>`EXISTS(SELECT 1 FROM inbox_visitor_waiting vw WHERE vw.conversation_id=${c}.id)`

/** Released to the team: the workspace's AI will not answer (draft or off) and a visitor is waiting. Migration 314
 * derives the inbox entries' `ai` and `ai_profile` flags with exactly this condition. */
export const releasedToTeamSql=(c:string)=>`NOT (${customerAiSql(`${c}.project_id`)}) AND ${visitorWaitingSql(c)}`

/** A conversation counts as held by its assistant when the site's own assistant condition holds and it is not released
 * to the team, so the team's normal views list it as one without an assistant. In auto this is the condition itself. */
export const aiHeldSql=(assistant:string,c='c')=>`(${assistant} AND NOT (${releasedToTeamSql(c)}))`
