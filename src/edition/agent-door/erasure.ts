/**
 * The agent door keeps its own copies of people and customer records: native attribution
 * (h2h_agent_operations) and Base's agents, audit, events, approvals, reviews and saved
 * outcomes (vendor ADOPTING.md, "Client custody boundary"). Native erasure rewrites those
 * copies in its own atomic batch. Ids, tools, targets, times, classes and decisions remain.
 */

/** The name member erasure gives the anonymized account (management/member-erasure.ts). */
export const formerTeammate='Former teammate'

// Customer erasure statements bind ?1 = project id and ?2 = contact id, like contact-erasure/scope.ts.
// The door serves one linked workspace, so another workspace's erasure never reaches its stores.
const linked='EXISTS(SELECT 1 FROM h2h_business_project WHERE singleton=1 AND project_id=?1)'
const subjects='SELECT ?2 value UNION ALL SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2'
const resources=`SELECT 'happytohelp://projects/'||?1||'/conversations/'||id FROM conversations WHERE project_id=?1 AND contact_id=?2
 UNION ALL SELECT 'happytohelp://projects/'||?1||'/conversations/'||id||'/context' FROM conversations WHERE project_id=?1 AND contact_id=?2`
/** A stored value names the contact, one of its conversations or a door resource for one.
 * The substring test only skips documents that cannot match before the exact JSON test. */
const references=(column:string)=>`(EXISTS(SELECT 1 FROM (${subjects}) s WHERE instr(${column},s.value)>0)
 AND EXISTS(SELECT 1 FROM json_tree(${column}) j WHERE j.type='text' AND (j.atom IN (${subjects}) OR j.atom IN (${resources}))))`
/** The native target and policy evidence stay; the subject, arguments and recipients go. */
const erasedSummary=(column:string)=>`json_set(json_remove(${column},'$.summary.target','$.summary.arguments','$.summary.recipients','$.summary.amount','$.summary.payee','$.summary.role'),'$.summary.items',json_array('Customer data erased'))`

export function contactDoorErasure(db:D1Database,projectId:string,contactId:string){
 const bound=(sql:string)=>db.prepare(sql).bind(projectId,contactId)
 return [
  // Held work for the customer is closed, never approved or sent: it reads as refused because
  // the record is unavailable. Executed results keep their receipt without the native output.
  bound(`UPDATE agent_door_approvals SET state=CASE WHEN state='pending' THEN 'refused' ELSE state END,
   result=CASE WHEN state='pending' THEN json_set(json_extract(saved,'$.result'),'$.outcome','refused','$.code','resource_unavailable') ELSE json_remove(result,'$.result') END,
   saved=json_set(${erasedSummary('saved')},'$.args',json('{}')),version=version+1
   WHERE ${linked} AND (${references('saved')} OR ${references('result')})`),
  // A replay of finished work refuses before it reads this; the saved native output goes.
  bound(`UPDATE agent_door_calls SET outcome=json_remove(outcome,'$.result') WHERE ${linked} AND ${references('outcome')}`),
  bound(`UPDATE agent_door_reviews SET saved=${erasedSummary('saved')} WHERE ${linked} AND ${references('saved')}`),
 ]
}

const quoted=(value:string)=>JSON.stringify(value)
const escapeRegExp=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
type Value={value:string|null;id?:string|null}

/**
 * Every copy of an erased teammate's name and email in the door stores becomes the
 * anonymized account's. An agent the teammate sponsored keeps its id; its display name
 * loses only an embedded copy of the teammate's name. Run before the account is anonymized.
 */
export async function memberDoorErasure(db:D1Database,userId:string):Promise<D1PreparedStatement[]>{
 // D1 limits compound SELECTs, so each copy is its own read.
 const read=async(queries:string[])=>(await db.batch<Value>(queries.map(sql=>db.prepare(sql).bind(userId)))).flatMap(result=>result.results)
 const [names,emails,agents]=await Promise.all([
  read([`SELECT name value FROM users WHERE id=?1`,`SELECT sponsor_name value FROM h2h_agent_operations WHERE sponsor_id=?1`,
   `SELECT json_extract(a.value,'$.name') value FROM h2h_agent_operations o,json_each(o.approvers_json) a WHERE json_extract(a.value,'$.id')=?1`,
   `SELECT sponsor_name value FROM agent_door_agents WHERE sponsor=?1`,`SELECT json_extract(row,'$.sponsor.name') value FROM agent_door_audit WHERE json_extract(row,'$.sponsor.id')=?1`,
   `SELECT json_extract(event,'$.actor.for.name') value FROM agent_door_events WHERE json_extract(event,'$.actor.for.id')=?1`,
   `SELECT json_extract(event,'$.actor.person.name') value FROM agent_door_events WHERE json_extract(event,'$.actor.person.id')=?1`,
   `SELECT json_extract(saved,'$.principal.person.name') value FROM agent_door_approvals WHERE json_extract(saved,'$.principal.person.id')=?1`,
   `SELECT json_extract(m.value,'$.name') value FROM agent_door_approvals p,json_each(p.approvals) m WHERE json_extract(m.value,'$.person')=?1`,
   `SELECT json_extract(saved,'$.principal.person.name') value FROM agent_door_reviews WHERE json_extract(saved,'$.principal.person.id')=?1`]),
  read([`SELECT email value FROM users WHERE id=?1`,
   ...['agent_door_approvals','agent_door_reviews'].map(table=>`SELECT json_extract(saved,'$.principal.person.email') value FROM ${table} WHERE json_extract(saved,'$.principal.person.id')=?1`)]),
  read([`SELECT id,name value FROM agent_door_agents WHERE sponsor=?1`,`SELECT agent_id id,agent_name value FROM h2h_agent_operations WHERE sponsor_id=?1`,
   `SELECT json_extract(row,'$.agent.id') id,json_extract(row,'$.agent.name') value FROM agent_door_audit WHERE json_extract(row,'$.sponsor.id')=?1`,
   `SELECT json_extract(event,'$.actor.agent.id') id,json_extract(event,'$.actor.agent.name') value FROM agent_door_events WHERE json_extract(event,'$.actor.for.id')=?1`,
   ...['agent_door_approvals','agent_door_reviews'].map(table=>`SELECT json_extract(saved,'$.principal.agent.id') id,json_extract(saved,'$.principal.agent.name') value FROM ${table} WHERE json_extract(saved,'$.principal.person.id')=?1`)]),
 ])
 const known=[...new Set(names.map(row=>row.value).filter((value):value is string=>!!value?.trim()&&value!==formerTeammate))]
 const addresses=[...new Set(emails.map(row=>row.value).filter((value):value is string=>!!value?.trim()&&value!=='erased:'+userId))]
 // The teammate's names and first names, longest first, as whole words.
 const words=[...new Set(known.flatMap(name=>[name.trim(),name.trim().split(/\s+/)[0]!]).filter(word=>word.length>1))].sort((a,b)=>b.length-a.length)
 const embedded=words.length?new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`,'giu'):null
 const renamed=[...new Map(agents.flatMap(({id,value})=>{
  if(!id||!value||!embedded)return []
  const to=value.replace(embedded,formerTeammate)
  return to===value?[]:[[id+'\n'+value,{id,from:value,to}] as const]
 })).values()]
 const statement=(sql:string,...values:unknown[])=>db.prepare(sql).bind(userId,formerTeammate,...values)
 // Saved native outputs embed attribution without ids (ticket history, activity rows):
 // replace whole JSON strings and "<agent> for <person>" labels before keyed rewrites.
 const text=(table:string,column:string,from:string,to:string)=>statement(`UPDATE ${table} SET ${column}=replace(${column},?3,?4) WHERE instr(${column},?3)>0`,from,to)
 const outputs=(from:string,to:string)=>[text('agent_door_calls','outcome',from,to),text('agent_door_approvals','result',from,to)]
 const label=(agent:string)=>`${agent}||' for '||?2`
 return [
  ...known.flatMap(name=>[
   ...outputs(quoted(name),quoted(formerTeammate)),
   ...outputs(' for '+quoted(name).slice(1),' for '+quoted(formerTeammate).slice(1)),
   text('agent_door_approvals','saved',quoted('Assign to '+name),quoted('Assign to '+formerTeammate)),
  ]),
  ...addresses.flatMap(address=>outputs(quoted(address),quoted('erased:'+userId))),
  ...renamed.flatMap(({from,to})=>[...outputs(quoted(from),quoted(to)),...outputs(quoted(from).slice(0,-1)+' for ',quoted(to).slice(0,-1)+' for ')]),
  statement('UPDATE h2h_agent_operations SET sponsor_name=?2 WHERE sponsor_id=?1'),
  statement(`UPDATE h2h_agent_operations SET approvers_json=(SELECT json_group_array(CASE WHEN json_extract(a.value,'$.id')=?1 THEN json_set(a.value,'$.name',?2) ELSE json(a.value) END) FROM json_each(h2h_agent_operations.approvers_json) a)
   WHERE EXISTS(SELECT 1 FROM json_each(h2h_agent_operations.approvers_json) WHERE json_extract(value,'$.id')=?1)`),
  statement('UPDATE agent_door_agents SET sponsor_name=?2 WHERE sponsor=?1'),
  statement(`UPDATE agent_door_events SET event=json_set(event,'$.actor.for.name',?2,'$.actor.label',${label("json_extract(event,'$.actor.agent.name')")}) WHERE json_extract(event,'$.actor.for.id')=?1`),
  statement(`UPDATE agent_door_events SET event=json_set(event,'$.actor.person.name',?2) WHERE json_extract(event,'$.actor.person.id')=?1`),
  statement(`UPDATE agent_door_audit SET row=json_set(row,'$.sponsor.name',?2,'$.label',${label("json_extract(row,'$.agent.name')")}) WHERE json_extract(row,'$.sponsor.id')=?1`),
  statement(`UPDATE agent_door_approvals SET saved=json_set(saved,'$.principal.person.name',?2,'$.principal.person.email','erased:'||?1) WHERE json_extract(saved,'$.principal.person.id')=?1`),
  statement(`UPDATE agent_door_approvals SET approvals=(SELECT json_group_array(CASE WHEN json_extract(m.value,'$.person')=?1 THEN json_set(m.value,'$.name',?2) ELSE json(m.value) END) FROM json_each(agent_door_approvals.approvals) m)
   WHERE EXISTS(SELECT 1 FROM json_each(agent_door_approvals.approvals) WHERE json_extract(value,'$.person')=?1)`),
  statement(`UPDATE agent_door_reviews SET saved=json_set(saved,'$.principal.person.name',?2,'$.principal.person.email','erased:'||?1) WHERE json_extract(saved,'$.principal.person.id')=?1`),
  ...[['agent_door_approvals','result'],['agent_door_calls','outcome']].map(([table,column])=>statement(`UPDATE ${table} SET ${column}=json_set(${column},'$.receipt.prepared_by.for.name',?2,'$.receipt.prepared_by.label',${label(`json_extract(${column},'$.receipt.prepared_by.agent.name')`)}) WHERE json_extract(${column},'$.receipt.prepared_by.for.id')=?1`)),
  ...renamed.flatMap(({id,from,to})=>[
   statement('UPDATE h2h_agent_operations SET agent_name=?4 WHERE sponsor_id=?1 AND agent_id=?3 AND agent_name=?5',id,to,from),
   statement('UPDATE agent_door_agents SET name=?4 WHERE sponsor=?1 AND id=?3 AND name=?5',id,to,from),
   statement(`UPDATE agent_door_events SET event=json_set(event,'$.actor.agent.name',?4,'$.actor.label',?4||' for '||?2) WHERE json_extract(event,'$.actor.for.id')=?1 AND json_extract(event,'$.actor.agent.id')=?3 AND json_extract(event,'$.actor.agent.name')=?5`,id,to,from),
   statement(`UPDATE agent_door_audit SET row=json_set(row,'$.agent.name',?4,'$.label',?4||' for '||?2) WHERE json_extract(row,'$.sponsor.id')=?1 AND json_extract(row,'$.agent.id')=?3 AND json_extract(row,'$.agent.name')=?5`,id,to,from),
   ...['agent_door_approvals','agent_door_reviews'].map(table=>statement(`UPDATE ${table} SET saved=json_set(saved,'$.principal.agent.name',?4) WHERE json_extract(saved,'$.principal.person.id')=?1 AND json_extract(saved,'$.principal.agent.id')=?3 AND json_extract(saved,'$.principal.agent.name')=?5`,id,to,from)),
  ]),
 ]
}
