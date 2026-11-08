import type { Env, Actor } from '../../platform/env';
import { requestGeneration, type AssignmentReplyGuard } from './repository';
import {isAutomaticInboundEmail} from '../integrations/inbound-origin';
import {AiReplyModeRefused,answerableTurnSql,customerAiSql} from './reply-mode';
export async function onCustomerMessage(env: Env, message: any, actor: Actor) {
    if (actor.role !== 'contact')
        return;
    const selected = await env.DB.prepare(`SELECT a.id,a.model FROM conversation_ai ca JOIN ai_profiles a ON a.id=ca.ai_id JOIN conversations c ON c.id=ca.conversation_id JOIN messages m ON m.id=c.last_message_id AND m.conversation_id=c.id WHERE c.id=? AND c.project_id=? AND a.project_id=c.project_id AND a.is_enabled=1 AND c.assigned_to IS NULL AND c.resolved_at IS NULL AND c.last_message_id=? AND c.revision=? AND ${customerAiSql('c.project_id')} AND ${answerableTurnSql('c.project_id','m.created_at')}`).bind(message.conversation_id, actor.projectId, message.id, message.revision).first();
    if (!selected)
        return;
    await requestGeneration(env, { projectId: actor.projectId, conversationId: message.conversation_id, actor, expectedRevision: message.revision, id: `reply:${message.id}` }, 'record').catch(quietRefusal);
}

/** A handoff answers only the still-waiting visitor turn. Reuse the message's
 * automatic command identity so retries, ceiling skips and uncertain attempts
 * cannot become another provider request, even across assistant changes.
 * An operator's handback after the turn's latest answer was cancelled or failed
 * before any provider request asks once more under an identity derived from that
 * answer, so repeating the same handback cannot queue a second request. */
export async function onAssistantAssignment(env:Env,projectId:string,conversationId:string,guard:AssignmentReplyGuard,handback=false){
    const message=await env.DB.prepare(`SELECT m.* FROM conversations c JOIN messages m ON m.id=c.last_message_id AND m.conversation_id=c.id AND m.project_id=c.project_id
        WHERE c.id=? AND c.project_id=? AND c.assigned_to IS NULL AND c.resolved_at IS NULL AND m.actor_role='contact' AND m.actor_id=c.contact_id AND ${customerAiSql('c.project_id')} AND ${answerableTurnSql('c.project_id','m.created_at')} AND (${guard.sql})`).bind(conversationId,projectId,...guard.params).first<any>();
    if(!message||await isAutomaticInboundEmail(env,projectId,message))return;
    const prior=await env.DB.prepare("SELECT id,state FROM ai_generations WHERE project_id=? AND conversation_id=? AND source_revision=? AND kind='reply' ORDER BY rowid DESC").bind(projectId,conversationId,message.revision).all<{id:string;state:string}>();
    // Completed, running and uncertain work stays authoritative.
    if(prior.results.length&&!(handback&&prior.results.every(row=>row.state==='cancelled'||row.state==='failed')))return;
    const id=prior.results.length?`reply:${message.id}:after:${prior.results[0].id}`:`reply:${message.id}`;
    const actor:Actor={id:message.actor_id,contactId:message.actor_id,projectId,role:'contact'};
    await requestGeneration(env,{projectId,conversationId,actor,expectedRevision:message.revision,id},'record',guard).catch(quietRefusal);
}

/** Automatic replies end quietly when the reply mode changed after their read. */
function quietRefusal(error:unknown){if(!(error instanceof AiReplyModeRefused))throw error}
