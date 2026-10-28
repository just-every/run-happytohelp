import {knowledgeAnswerFields} from '../knowledge/model-door'
import {finalizeGeneration} from './generation-finalization'
import type { Env, Job } from '../../platform/env';
import type { Generation } from './repository';
import { reconcileTerminalAttempt } from './recovery';
import { assertModelConfigured } from './configuration';
import { transition } from './repository';
import { generationCurrentness } from './generation-currentness';
import { executeGenerationProvider } from './generation-provider';
import { requireGenerationEffects, type GenerationEffects } from './generation-effects';
export { onCustomerMessage } from './customer-message';
export { recoverQueuedGenerations } from './generation-queue';
export async function handleGeneration(env: Env, job: Job, effects: GenerationEffects) {
    if (job.type !== 'ai.generate')
        return false;
    requireGenerationEffects(effects);
    const row = await env.DB.prepare('SELECT * FROM ai_generations WHERE id=? AND project_id=?').bind(job.id, job.projectId).first<Generation>();
    if (!row)
        return true;
    env={...env,APP_ORIGIN:env.APP_ORIGIN||JSON.parse(row.options_json||'{}').application_origin};
    if (['completed', 'cancelled', 'superseded', 'failed', 'uncertain'].includes(row.state)) {
        await reconcileTerminalAttempt(env, row.id);
        return true;
    }
    if (row.state === 'running') {
        // A previous delivery may have reached the provider. Never replay it.
        await transition(env, row.id, 'uncertain', 'Interrupted attempt; provider outcome requires review');
        await env.DB.prepare("UPDATE ai_attempts SET state='uncertain',finished_at=? WHERE generation_id=? AND state='running'").bind(new Date().toISOString(), row.id).run();
        return true;
    }
    try {
        assertModelConfigured(env, row.model);
    }
    catch (error) {
        await env.DB.prepare("UPDATE ai_generations SET state='failed',error=? WHERE id=? AND state='queued'").bind(String(error), row.id).run();
        if (row.kind === 'suggestions')
            await effects.publishSuggestions(env, row.project_id, row.conversation_id);
        return true;
    }
    const claimed = await env.DB.prepare("UPDATE ai_generations SET state='running',updated_at=? WHERE id=? AND state='queued'").bind(new Date().toISOString(), row.id).run();
    if (!claimed.meta.changes)
        return true;
    const attemptId = crypto.randomUUID(), abort = new AbortController();
    await env.DB.prepare("INSERT INTO ai_attempts(id,generation_id,state,started_at) VALUES(?,?,'running',?)").bind(attemptId, row.id, new Date().toISOString()).run();
    let providerStarted = false, finalCommitted = false;
    const checkCurrent = generationCurrentness(env, row, abort);
    const timer = setInterval(() => { checkCurrent().catch(error => abort.abort(error)); }, 1000);
    const deadline = setTimeout(() => abort.abort(new Error('GENERATION_DEADLINE')), 180000);
    try {
        await checkCurrent();
        const { result, usage: usageResult } = await executeGenerationProvider(env, row, attemptId, abort, checkCurrent, effects, () => { providerStarted = true; });
        // A generation cancelled meanwhile (by an operator or contact erasure) does not keep provider output.
        await env.DB.prepare("UPDATE ai_generations SET output_json=? WHERE id=? AND state<>'cancelled'").bind(JSON.stringify({ result:await knowledgeAnswerFields(env,row.project_id,row.id,result), usage: usageResult }), row.id).run();
        await checkCurrent();
        const admitted = await finalizeGeneration(env,row,attemptId,result,usageResult);
        finalCommitted = admitted?.accepted ?? false;
        if (admitted?.accepted && admitted.message) {
            await effects.messageCommitted(env,row,admitted.message,JSON.parse(row.actor_json),Boolean(admitted.duplicate));
        }
    }
    catch (error) {
        const persisted = await env.DB.prepare('SELECT state FROM ai_generations WHERE id=?').bind(row.id).first<{
            state: string;
        }>();
        const superseded = String(abort.signal.reason).includes('Conversation superseded');
        const state = finalCommitted || persisted?.state === 'completed' ? 'completed' : persisted?.state === 'cancelled' ? 'cancelled' : superseded ? 'superseded' : providerStarted ? 'uncertain' : 'failed';
        await transition(env, row.id, state, error);
        await env.DB.prepare('UPDATE ai_attempts SET state=?,error=?,finished_at=? WHERE id=?').bind(state, String(error).slice(0, 2000), new Date().toISOString(), attemptId).run();
    }
    finally {
        clearInterval(timer);
        clearTimeout(deadline);
        if (row.kind === 'suggestions')
            await effects.publishSuggestions(env, row.project_id, row.conversation_id);
        const terminal = await env.DB.prepare('SELECT state,error FROM ai_generations WHERE id=?').bind(row.id).first();
        await effects.emit(env, row, { type: 'generation.terminal', operatorOnly: true, generationId: row.id, ...terminal });
        if (row.kind === 'reply' && terminal?.state !== 'completed')
            await effects.emit(env, row, { type: 'reply_cancelled', payload: { local_id: `generation:${row.id}` } });
    }
    return true;
}
