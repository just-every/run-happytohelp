/** Restoring support history never restores a live procedure rollout. */
export function agentArchiveRow(table,row){
 if(table==='procedure_releases')return {...row,state:'stopped',stopped_at:row.stopped_at??row.created_at};
 return row;
}
export async function agentArchiveSafety({db,tables}){
 const q=name=>'"'+tables[name].replaceAll('"','""')+'"',checks=[];
 if(tables.followup_obligations&&tables.conversations&&tables.messages){
  checks.push(`SELECT 1 FROM ${q('followup_obligations')} o LEFT JOIN ${q('conversations')} c ON c.id=o.conversation_id AND c.project_id=o.project_id LEFT JOIN ${q('messages')} m ON m.id=o.message_id AND m.project_id=o.project_id AND m.conversation_id=o.conversation_id WHERE c.id IS NULL OR m.id IS NULL OR o.quote_start<0 OR o.quote_end<=o.quote_start OR o.quote_end>length(m.content) LIMIT 1`);
  if(tables.escalation_issues)checks.push(`SELECT 1 FROM ${q('followup_obligations')} o LEFT JOIN ${q('escalation_issues')} i ON i.id=o.dependency_id AND i.project_id=o.project_id WHERE o.dependency_id IS NOT NULL AND i.id IS NULL LIMIT 1`);
 }
 if(tables.procedure_releases&&tables.procedure_versions&&tables.training_runs)checks.push(`SELECT 1 FROM ${q('procedure_releases')} r LEFT JOIN ${q('procedure_versions')} v ON v.id=r.version_id AND v.project_id=r.project_id AND v.procedure_key=r.procedure_key LEFT JOIN ${q('training_runs')} e ON e.id=r.evaluation_id AND e.project_id=r.project_id WHERE v.id IS NULL OR e.id IS NULL OR r.state<>'stopped' LIMIT 1`);
 if(tables.procedure_cohort&&tables.procedure_releases&&tables.conversations)checks.push(`SELECT 1 FROM ${q('procedure_cohort')} pc LEFT JOIN ${q('procedure_releases')} r ON r.id=pc.release_id AND r.project_id=pc.project_id LEFT JOIN ${q('conversations')} c ON c.id=pc.conversation_id AND c.project_id=pc.project_id WHERE r.id IS NULL OR c.id IS NULL LIMIT 1`);
 if(tables.procedure_generation&&tables.procedure_releases&&tables.ai_generations)checks.push(`SELECT 1 FROM ${q('procedure_generation')} pg LEFT JOIN ${q('procedure_releases')} r ON r.id=pg.release_id AND r.version_id=pg.version_id LEFT JOIN ${q('ai_generations')} g ON g.id=pg.generation_id AND g.project_id=r.project_id WHERE r.id IS NULL OR g.id IS NULL LIMIT 1`);
 if(checks.length){const results=await db.batch(checks.map(sql=>db.prepare(sql)));if(results.some(r=>r.results.length))throw Error('Agent archive contains an invalid source, procedure or live release relationship');}
}
