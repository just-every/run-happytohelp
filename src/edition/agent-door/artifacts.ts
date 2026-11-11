import type {AgentArtifactMap} from '../../vendor/agent-base/modules/agent-door/index.ts'

// Selector mechanics adapted from default-seed/src/agent-door/erasure.ts at
// Base 8b925fa5ffaa577df9f2e4ebab6ede8af5155baa; inventory and native scope are edition-owned.
// Seed-owned custody inventory for the 0.2.96 module. Select native ids, exact
// addresses and native operation/resource ids; a common name alone never selects
// somebody else's history. Native attribution and policy retain opaque ids under
// this edition's existing erasure rules. Business projections are external
// custody: tombstone pulls and Business stop/unreachable rules purge them.
const sourceId = "CASE WHEN subject.type='object' THEN json_extract(subject.value,'$.sourceUserId') END"
const recordedName = "CASE WHEN subject.type='object' THEN json_extract(subject.value,'$.name') END"
const textValue = `coalesce((${sourceId}),(${recordedName}))`
const tokenCharacter = "'[A-Za-z0-9_@.+/:-]'"
// Preserve identifier/URI/version tokens. A sentence's final period delimits a
// name, but the period within version 1.0 or another token does not. Colons
// delimit recorded names while remaining part of source identifiers. Non-ASCII
// letters also continue a name; Unicode spaces/punctuation delimit it.
const boundary = (position: string, outward: number) => {
  const char = `substr(text,${position},1)`, next = `substr(text,(${position})+(${outward}),1)`
  return `(${char} NOT GLOB ${tokenCharacter} OR ((${recordedName}) IS NOT NULL AND (${char}=':' OR (${char}='.' AND ${next} NOT GLOB ${tokenCharacter}))))
    AND NOT ((${recordedName}) IS NOT NULL AND coalesce(unicode(${char}),0)>127 AND ${char} NOT GLOB '[\u00a0\u2000-\u206f\u2e00-\u2e7f\u3000-\u303f]')`
}
// Check every literal occurrence, including one after an embedded occurrence.
const textMention = (column: string) => `EXISTS(
  WITH RECURSIVE hits(text,source,pos) AS (
    SELECT content.value,(${textValue}),instr(content.value,(${textValue}))
    FROM json_tree(CASE WHEN json_valid(${column}) THEN ${column} ELSE json_quote(${column}) END) content
    WHERE content.type='text'
    UNION ALL
    SELECT text,source,pos+instr(substr(text,pos+1),source) FROM hits
    WHERE pos>0 AND instr(substr(text,pos+1),source)>0
  )
  SELECT 1 FROM hits WHERE pos>0
    AND ${boundary('pos-1', -1)}
    AND ${boundary('pos+length(source)', 1)}
)`
const mentions = (table: string, columns: string[]) => 'EXISTS(SELECT 1 FROM json_each(?1) subject WHERE ' + columns.map(name => {
  const column = table + '.' + name
  return "(subject.type='text' AND instr(CAST(" + column + " AS TEXT),CAST(subject.value AS TEXT))>0) OR (subject.type='object' AND (CAST(" + column + " AS TEXT)=(" + sourceId + ') OR ' + textMention(column) + '))'
}).join(' OR ') + ')'
const calls=mentions('agent_door_calls',['key','outcome'])
const approvals=mentions('agent_door_approvals',['saved','approvals','result'])
const reviews=mentions('agent_door_reviews',['saved','marked_by'])
const audits=mentions('agent_door_audit',['row','evidence'])
const decisions=`SELECT decision_id FROM agent_door_calls WHERE ${calls}
 UNION SELECT json_extract(saved,'$.decision_id') FROM agent_door_approvals WHERE ${approvals}
 UNION SELECT json_extract(saved,'$.decision_id') FROM agent_door_reviews WHERE ${reviews}
 UNION SELECT id FROM agent_door_audit WHERE ${audits}`
const match=(sql:string)=>({sql,params:['values']})
const shared:AgentArtifactMap['artifacts']=[
 {table:'agent_door_retired_refs',columns:['digest','marker'],unrelated:'Value-free suppression digests and erasure markers preserve retirement across restore.'},
 {table:'agent_door_relay',columns:['sequence','decision_id','business'],unrelated:'Value-free decision ids and installation Business id; projections are computed from erasure-aware audit. Installation-private, never portable.'},
 {table:'agent_door_calls',columns:['agent','key','digest','decision_id','created_at','state','outcome','expires_at'],match:match(`decision_id IN (${decisions})`)},
 {table:'agent_door_audit',columns:['sequence','id','at','agent','classes','row','evidence'],match:match(`id IN (${decisions}) OR json_extract(row,'$.decision_id') IN (${decisions}) OR json_extract(row,'$.replay_of') IN (${decisions})`)},
 {table:'agent_door_approvals',columns:['id','state','saved','approvals','result','version'],match:match(`json_extract(saved,'$.decision_id') IN (${decisions}) OR ${approvals}`)},
 {table:'agent_door_reviews',columns:['id','state','saved','marked_by','marked_at'],match:match(`json_extract(saved,'$.decision_id') IN (${decisions}) OR ${reviews}`)},
 {table:'agent_door_events',columns:['sequence','id','uri','event'],match:match(`${mentions('agent_door_events',['uri','event'])} OR json_extract(event,'$.decision_id') IN (${decisions})`)},
 {table:'agent_door_usage',columns:['decision_id','at','seed','specialist','agent','classes'],match:match(`decision_id IN (${decisions}) OR ${mentions('agent_door_usage',['classes'])}`)},
 {table:'agent_door_replay_aliases',columns:['agent','alias','call_id','tombstone'],unrelated:'Installation-private HMAC replay aliases, bounded by the original call expiry; excluded from all archives and exports.'},
]
const agents=['id','name','specialist','sponsor','sponsor_name','revoked','window','requests','tombstone']
const stateColumns=['id','envelope','local_document','local_revision','local_paused','decision_lock','decision_until']
// A customer is never a policy principal, so contact erasure leaves signed policy and admission leases alone.
export const contactAgentArtifacts:AgentArtifactMap={artifacts:[...shared,
 {table:'agent_door_state',columns:stateColumns,unrelated:'Signed installation policy and admission leases. Customer records are never policy principals.'},
 {table:'agent_door_agents',columns:agents,unrelated:'Non-person agent identities and native teammate sponsors; customers are not operators.'}]}
// An erased teammate is an operator: the same erasure batch retires their policy references (native id and mapped Business
// member ids, from operatorPolicyRefs) from local policy and retires them from the Business-signed roster (bs_team, the stored
// settings document and bs_retired tombstones; rer 0.2.107, migration 322_business_retired.sql).
export const memberAgentArtifacts:AgentArtifactMap={artifacts:[...shared,
 {table:'agent_door_state',columns:stateColumns,retire:{refs:'operatorPolicyRefs'}},
 {table:'agent_door_agents',columns:agents,match:match("sponsor IN (SELECT value FROM json_each(?1))")}]}
