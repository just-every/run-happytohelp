import type { Env } from '../../platform/env';
import { cronRoom } from '../../platform/cron-budget';
import { transition } from './repository';
import { reconcileTerminalAttempt } from './recovery';
import { requireGenerationEffects, type GenerationEffects } from './generation-effects';
export async function recoverQueuedGenerations(env: Env, effects: GenerationEffects) {
    requireGenerationEffects(effects);
    if (!cronRoom(env, 3)) return;
    const interrupted = await env.DB.prepare("SELECT DISTINCT g.id FROM ai_generations g JOIN ai_attempts a ON a.generation_id=g.id WHERE g.state NOT IN ('queued','running') AND a.state='running' AND (g.state='completed' OR g.updated_at<?) LIMIT 100").bind(new Date(Date.now() - 240000).toISOString()).all<{
        id: string;
    }>();
    for (const row of interrupted.results) {
        // Keep the later recovery scans available even with a terminal backlog.
        if (!cronRoom(env, 3)) break;
        await reconcileTerminalAttempt(env, row.id);
    }
    const stale = await env.DB.prepare("SELECT id,project_id,conversation_id,kind FROM ai_generations WHERE state='running' AND updated_at<? LIMIT 100").bind(new Date(Date.now() - 240000).toISOString()).all<any>();
    for (const row of stale.results) {
        if (!cronRoom(env, (row.kind === 'suggestions' ? 3 : 2) + 1)) break;
        await transition(env, row.id, 'uncertain', 'Execution deadline passed without a durable terminal outcome');
        await env.DB.prepare("UPDATE ai_attempts SET state='uncertain',finished_at=? WHERE generation_id=? AND state='running'").bind(new Date().toISOString(), row.id).run();
        if (row.kind === 'suggestions')
            await effects.publishSuggestions(env, row.project_id, row.conversation_id);
    }
    const jobs = await env.DB.prepare("SELECT g.id,g.project_id FROM ai_generations g JOIN projects p ON p.id=g.project_id WHERE g.state='queued' AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=g.project_id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL) ORDER BY g.created_at LIMIT 100").all<{
        id: string;
        project_id: string;
    }>();
    for (const job of jobs.results)
        await env.JOBS.send({ type: 'ai.generate', id: job.id, projectId: job.project_id });
}
