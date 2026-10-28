import type { Env } from '../../platform/env';
import type { Generation } from './repository';
import { assistanceProfileSql, replyProfileSql } from './selection';

export function generationCurrentness(env: Env, row: Generation, abort: AbortController) {
  const selected = JSON.parse(row.ai_profile_json);
  const operatorHash=JSON.parse(row.options_json||'{}').operator_session_hash;
  const profileSql = row.kind === 'suggestions' ? assistanceProfileSql : replyProfileSql;
  return async () => {
    const current = await env.DB.prepare(`
      SELECT g.state,c.revision,
        (SELECT revision FROM context_subjects WHERE project_id=c.project_id AND subject_id=c.contact_id) context_revision,
        c.assigned_to,c.resolved_at,EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=? AND s.actor_id=json_extract(g.actor_json,'$.id') AND s.role<>'contact' AND s.revoked_at IS NULL AND s.expires_at>? AND (s.project_id IS NULL OR s.project_id=g.project_id) AND EXISTS(SELECT 1 FROM memberships m LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.id=mr.role_key AND pr.project_id=m.project_id WHERE m.project_id=g.project_id AND m.user_id=s.actor_id AND m.role=json_extract(g.actor_json,'$.role') AND (NOT EXISTS(SELECT 1 FROM ai_tool_traces t WHERE t.generation_id=g.id AND t.tool_name IN ('read_verified_resolution','propose_knowledge_change')) OR m.role='owner' OR (mr.role_key IS NULL AND m.role IN ('admin','operator')) OR EXISTS(SELECT 1 FROM json_each(pr.permissions_json) WHERE value='knowledge.edit')))) operator_session_current,a.id ai_id,a.model,a.prompt,a.is_enabled
      FROM ai_generations g
      JOIN conversations c ON c.id=g.conversation_id AND c.project_id=g.project_id
      LEFT JOIN ai_profiles a ON a.id=${profileSql} AND a.project_id=c.project_id
      WHERE g.id=?
    `).bind(typeof operatorHash==='string'?operatorHash:'',Date.now(),row.id).first<any>();
    const changed = !current
      || (typeof operatorHash==='string'&&!current.operator_session_current)
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
