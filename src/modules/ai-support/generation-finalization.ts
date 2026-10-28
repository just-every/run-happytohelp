import type { Env, Actor } from '../../platform/env';
import type { Generation } from './repository';
import { transition } from './repository';
import { assistanceProfileSql } from './selection';
import { admitMessage } from '../conversations/admission';

/** Commit only while the captured conversation and policy frontier still match. */
export async function finalizeGeneration(env: Env, row: Generation, attemptId: string, result: any, usage: unknown) {
  if (row.kind === 'suggestions') {
    const completed = await env.DB.prepare(`
      UPDATE ai_generations SET state='completed',output_json=?,updated_at=?
      WHERE id=? AND state='running' AND EXISTS(
        SELECT 1 FROM conversations c
        JOIN ai_profiles a ON a.id=${assistanceProfileSql} AND a.project_id=c.project_id
        WHERE c.id=ai_generations.conversation_id AND c.revision=source_revision
          AND (SELECT revision FROM context_subjects WHERE project_id=c.project_id AND subject_id=c.contact_id)=source_context_revision
          AND c.resolved_at IS NULL AND a.id=ai_generations.ai_id AND a.is_enabled=1
          AND a.model=json_extract(ai_profile_json,'$.model')
          AND a.prompt=json_extract(ai_profile_json,'$.prompt')
      )
    `).bind(JSON.stringify({ result, usage }), new Date().toISOString(), row.id).run();
    if (!completed.meta.changes) await transition(env, row.id, 'superseded', 'Conversation or AI policy changed');
    await finishAttempt(env, attemptId, Boolean(completed.meta.changes));
    return null;
  }

  if(result?.requiresHumanReview===true){
    await transition(env,row.id,'superseded','Internal promise/dependency work requires human review before a customer update');
    await finishAttempt(env,attemptId,false);
    return null;
  }

  if (!result?.response?.trim()) throw new Error('Provider returned no customer reply');
  const admitted = await admitMessage(env, {
    projectId: row.project_id,
    conversationId: row.conversation_id,
    actor: JSON.parse(row.actor_json) as Actor,
    localId: `generation:${row.id}`,
    content: result.response,
    expectedRevision: row.source_revision,
    expectedLastMessageId: row.source_last_message_id,
    generationId: row.id,
    citations: result.citations,
  });
  if (!admitted.accepted) await transition(env, row.id, 'superseded', admitted.reason);
  await finishAttempt(env, attemptId, admitted.accepted);
  return admitted;
}

async function finishAttempt(env: Env, attemptId: string, completed: boolean) {
  await env.DB.prepare('UPDATE ai_attempts SET state=?,finished_at=? WHERE id=?')
    .bind(completed ? 'completed' : 'superseded', new Date().toISOString(), attemptId).run();
}
