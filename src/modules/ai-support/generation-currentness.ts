import {ticketScopeSql} from '../access/ticket-scope';
import type { Env } from '../../platform/env';
import type { Generation } from './repository';
import { assistanceProfileSql, replyProfileSql } from './selection';

export function generationCurrentness(env: Env, row: Generation, abort: AbortController) {
  const selected = JSON.parse(row.ai_profile_json);
  const profileSql = row.kind === 'suggestions' ? assistanceProfileSql : replyProfileSql;
  return async () => {
    const current = await env.DB.prepare(`
      SELECT g.state,c.revision,
        (SELECT revision FROM context_subjects WHERE project_id=c.project_id AND subject_id=c.contact_id) context_revision,
        c.assigned_to,c.resolved_at,a.id ai_id,a.model,a.prompt,a.is_enabled
      FROM ai_generations g
      JOIN conversations c ON c.id=g.conversation_id AND c.project_id=g.project_id
      LEFT JOIN ai_profiles a ON a.id=${profileSql} AND a.project_id=c.project_id
      WHERE g.id=? AND (json_extract(g.actor_json,'$.role')='contact' OR ${ticketScopeSql("json_extract(g.actor_json,'$.id')")})
    `).bind(row.id).first<any>();
    const changed = !current
      || current.context_revision === null
      || current.context_revision !== row.source_context_revision
      || current.ai_id !== row.ai_id
      || current.is_enabled !== 1
      || current.model !== selected.model
      || current.prompt !== selected.prompt
      || current.state !== 'running'
      || current.revision !== row.source_revision
      || (row.kind === 'reply' && current.assigned_to)
      || current.resolved_at;
    if (changed) {
      abort.abort('Conversation superseded');
      throw new Error('GENERATION_SUPERSEDED');
    }
  };
}
