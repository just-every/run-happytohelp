import assert from 'node:assert/strict'

// The cutover page's counts as every row answers them: the statements cutover/counts.ts ran before migration 317
// kept derived sets and tallies (src/modules/management/README.md, "Cutover"), here only as an independent check.
// `all(sql,...args)` returns the rows of one statement.
export const legacyMarker='"package":"'
const marker=legacyMarker
/** The legacy count and last sweep, binding the workspace as ?1 and the package marker as ?2. */
export const legacySql=`WITH journal AS (SELECT c.id conversation,r.run_id run FROM conversations c
   CROSS JOIN legacy_import_rows r ON r.source_table='conversations' AND r.source_id=c.id AND r.status='mapped'
   WHERE c.project_id=?1),
  runs AS (SELECT run.state,run.completed_at,CASE WHEN instr(run.source_json,?2)>0
    THEN 'legacy-package:'||substr(run.source_json,instr(run.source_json,?2)+length(?2),64) END package
   FROM legacy_import_runs run WHERE run.id IN (SELECT run FROM journal))
  SELECT (SELECT COUNT(DISTINCT conversation) FROM journal) imported,
   (SELECT MAX(CASE WHEN p.id IS NULL THEN CASE WHEN runs.state='complete' THEN runs.completed_at END
     WHEN p.state='complete' THEN p.completed_at END) FROM runs LEFT JOIN legacy_import_runs p ON p.id=runs.package) swept`
const widgetSql=since=>`SELECT COUNT(*) n FROM conversations c
  WHERE c.project_id=?${since===null?'':' AND c.created_at>?'}
   AND c.channel='widget' AND c.submitter_type='contact' AND c.mailbox_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM inbound_emails e WHERE e.project_id=c.project_id AND e.conversation_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM move_in_conversations i WHERE i.conversation_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM legacy_import_rows l WHERE l.source_table='conversations' AND l.source_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM ticket_followups f WHERE f.conversation_id=c.id)
   AND EXISTS(SELECT 1 FROM messages m WHERE m.project_id=c.project_id AND m.conversation_id=c.id AND m.actor_role='contact'
    AND NOT EXISTS(SELECT 1 FROM inbound_emails r WHERE r.project_id=m.project_id AND r.message_id=m.id))`
const iso=ms=>ms==null?null:new Date(ms).toISOString()

/** Every count the page shows, recomputed from the workspace's rows. */
export async function cutoverOracle(all,projectId){
 const one=async(sql,...args)=>(await all(sql,...args))[0]
 const zendesk=(await one("SELECT COUNT(*) n FROM move_in_conversations m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.project_id=? AND m.vendor='zendesk'",projectId)).n
 const pull=(await one("SELECT updated_at FROM move_in_zendesk_pulls WHERE project_id=? AND state='applied' ORDER BY updated_at DESC LIMIT 1",projectId))?.updated_at??null
 const legacy=await one(legacySql,projectId,marker)
 const newest=async source=>(await one('SELECT max(recorded_at) at FROM cutover_steps WHERE project_id=? AND source=?',projectId,source))?.at??null
 const since=async source=>{const marks=[pull,legacy.swept,await newest(source)].filter(mark=>typeof mark==='number');return marks.length?Math.max(...marks):null}
 const [emailSince,widgetSince]=[await since('email'),await since('widget')]
 const emails=(await one(`SELECT COUNT(*) n FROM inbound_emails WHERE project_id=? AND state='delivered'${emailSince===null?'':' AND created_at>?'}`,projectId,...(emailSince===null?[]:[emailSince]))).n
 const widgets=(await one(widgetSql(widgetSince),projectId,...(widgetSince===null?[]:[widgetSince]))).n
 return {zendesk:{imported:zendesk},legacy:{imported:legacy.imported,lastSweep:legacy.swept===null?null:{at:iso(legacy.swept)}},email:{arrivals:emails,since:iso(emailSince)},widget:{arrivals:widgets,since:iso(widgetSince)}}
}

/** The read's counts equal the recomputation (the last pull's own totals come from its unchanged view). */
export async function assertCutoverCounts(all,projectId,sources,label){
 const oracle=await cutoverOracle(all,projectId),counts=Object.fromEntries(sources.map(source=>[source.id,source.counts]))
 assert.deepEqual({zendesk:{imported:counts.zendesk.imported},legacy:counts.legacy,email:counts.email,widget:counts.widget},oracle,label+': the cutover counts equal every row recomputed')
 return oracle
}

/** Migration 317's derived sets, runs and tallies equal a fresh computation, for every workspace. */
export async function assertCutoverDerived(all,label){
 assert.deepEqual(await all('SELECT conversation_id,project_id FROM cutover_zendesk_conversations ORDER BY conversation_id'),
  await all("SELECT c.id conversation_id,c.project_id FROM move_in_conversations m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.vendor='zendesk' ORDER BY c.id"),label+': Zendesk-imported conversations')
 assert.deepEqual(await all('SELECT conversation_id,run_id,project_id FROM cutover_legacy_conversations ORDER BY conversation_id,run_id'),
  await all("SELECT c.id conversation_id,r.run_id,c.project_id FROM legacy_import_rows r JOIN conversations c ON c.id=r.source_id WHERE r.source_table='conversations' AND r.status='mapped' ORDER BY c.id,r.run_id"),label+': legacy-journaled conversations by run')
 assert.deepEqual(await all('SELECT conversation_id,project_id,created_at FROM cutover_widget_arrivals ORDER BY conversation_id'),
  await all(`SELECT c.id conversation_id,c.project_id,c.created_at FROM conversations c WHERE ${widgetSql(null).split('WHERE c.project_id=?')[1].trim().replace(/^AND /,'')} ORDER BY c.id`),label+': widget arrivals')
 assert.deepEqual(await all('SELECT project_id,run_id,conversations FROM cutover_legacy_runs ORDER BY project_id,run_id'),
  await all('SELECT project_id,run_id,count(*) conversations FROM cutover_legacy_conversations GROUP BY project_id,run_id ORDER BY project_id,run_id'),label+': legacy runs by workspace')
 assert.deepEqual(await all('SELECT project_id,zendesk,legacy,widget FROM cutover_tallies WHERE zendesk<>0 OR legacy<>0 OR widget<>0 ORDER BY project_id'),
  await all(`SELECT project_id,sum(zendesk) zendesk,sum(legacy) legacy,sum(widget) widget FROM (SELECT project_id,1 zendesk,0 legacy,0 widget FROM cutover_zendesk_conversations UNION ALL SELECT project_id,0,1,0 FROM (SELECT DISTINCT project_id,conversation_id FROM cutover_legacy_conversations) UNION ALL SELECT project_id,0,0,1 FROM cutover_widget_arrivals) GROUP BY project_id ORDER BY project_id`),label+': cutover tallies')
}
