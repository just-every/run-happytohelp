import type { AgentArtifactMap } from '../../index.ts'

// Penny cloud/sd-door-adopt-penny-1 plus the additive migration below.
// Every agent-door table and column is declared. ?1 is a JSON array of the native
// erasure plan's selected identifiers and personal literals (plan.literals), never caller SQL.
const mentions = (columns: string[]) => 'EXISTS(SELECT 1 FROM json_each(?1) subject WHERE ' + columns.map(column => "instr(CAST(" + column + " AS TEXT),CAST(subject.value AS TEXT))>0").join(' OR ') + ')'
const calls = mentions(['key', 'outcome']), approvals = mentions(['saved', 'approvals', 'result']), reviews = mentions(['saved', 'marked_by']), audits = mentions(['row', 'evidence'])
const decisions = "SELECT decision_id FROM agent_door_calls WHERE " + calls + " UNION SELECT json_extract(saved,'$.decision_id') FROM agent_door_approvals WHERE " + approvals + " UNION SELECT json_extract(saved,'$.decision_id') FROM agent_door_reviews WHERE " + reviews + " UNION SELECT id FROM agent_door_audit WHERE " + audits + " UNION SELECT door_operation_id FROM audit_entries WHERE entity_id IN (SELECT value FROM json_each(?1)) OR " + mentions(['details_json'])
const match = (sql: string) => ({ sql, params: ['values'] })
export const pennyAgentArtifacts: AgentArtifactMap = { artifacts: [
  { table: 'agent_door_relay', columns: ['sequence','decision_id','business'], unrelated: 'Value-free decision ids and installation Business id only; projections are computed from the erasure-aware audit.' },
  { table: 'agent_door_state', columns: ['id','envelope','local_document','local_revision','local_paused','decision_lock','decision_until'], unrelated: 'Installation policy and admission leases; Penny customer subjects are not policy principals.' },
  { table: 'agent_door_agents', columns: ['id','name','specialist','sponsor','sponsor_name','revoked','window','requests','tombstone'], unrelated: 'Non-person agent identities and native operator sponsors; Penny customer subjects are not operators.' },
  { table: 'agent_door_calls', columns: ['agent','key','digest','decision_id','created_at','state','outcome','expires_at'], match: match('decision_id IN (' + decisions + ')') },
  { table: 'agent_door_audit', columns: ['sequence','id','at','agent','classes','row','evidence'], match: match('id IN (' + decisions + ') OR json_extract(row,\'$.decision_id\') IN (' + decisions + ')') },
  { table: 'agent_door_approvals', columns: ['id','state','saved','approvals','result','version'], match: match('json_extract(saved,\'$.decision_id\') IN (' + decisions + ') OR ' + approvals) },
  { table: 'agent_door_reviews', columns: ['id','state','saved','marked_by','marked_at'], match: match('json_extract(saved,\'$.decision_id\') IN (' + decisions + ') OR ' + reviews) },
  { table: 'agent_door_events', columns: ['sequence','id','uri','event'], match: match(mentions(['uri','event']) + ' OR json_extract(event,\'$.decision_id\') IN (' + decisions + ')') },
  { table: 'agent_door_usage', columns: ['decision_id','at','seed','specialist','agent','classes'], match: match('decision_id IN (' + decisions + ')') },
  { table: 'agent_door_replay_aliases', columns: ['agent','alias','call_id','tombstone'], unrelated: 'Installation-private, value-free replay aliases; excluded from archives and exports.' },
] }

