// Persist known history, without replacing any report query or product service.
export const formulaComments=['=SUM(1,2)','+1','-1','@SUM(1,2)','\tplain','\rplain',' \t=1','safe "quoted", comment'];
export const scalePath='/api/dashboard/projects/p/reports?period=custom&start=2026-03-07&end=2026-03-10';
const instants=['2026-03-07T05:00:00Z','2026-03-08T06:59:59Z','2026-03-08T07:00:00Z','2026-03-09T03:59:59Z','2026-03-10T03:59:59Z'];

export async function seedScaleOracles(h){
 const fixtures=Array.from({length:10001},(_,index)=>{
  const i=index+1,response=((i*37)%10007+1)*1000;
  const created=Date.parse(instants[index%instants.length]),resolution=response+((i*53)%10009+1)*1000;
  return {id:'bulk-'+String(i).padStart(5,'0'),created,response,resolution,
   day:['2026-03-07','2026-03-08','2026-03-08','2026-03-08','2026-03-09'][index%5],
   ordinal:i%3===0?2:1,reopened:i%7===0,outcome:['ai','human','assisted','unknown'][index%4],
   value:i%5===0?null:i%2===0?1:-1,comment:formulaComments[index%formulaComments.length]};
 });
 await h.call('/api/management/projects/p/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({timezone:'America/New_York'})});
 // Each JSON batch is small; the JS fixtures are also the independent oracle input.
 for(let offset=0;offset<fixtures.length;offset+=250){
  const data=JSON.stringify(fixtures.slice(offset,offset+250));
  const query=sql=>h.db.prepare(sql).bind(data);
  await h.db.batch([
   query(`WITH seed AS (SELECT value j FROM json_each(?))
    UPDATE conversations SET created_at=(SELECT json_extract(j,'$.created') FROM seed WHERE json_extract(j,'$.id')=conversations.id),
     resolved_at=(SELECT CASE WHEN json_extract(j,'$.reopened')=0 THEN json_extract(j,'$.created')+json_extract(j,'$.resolution')+(json_extract(j,'$.ordinal')-1)*1000 END FROM seed WHERE json_extract(j,'$.id')=conversations.id),
     revision=2 WHERE id IN (SELECT json_extract(j,'$.id') FROM seed)`),
   query(`WITH seed AS (SELECT value j FROM json_each(?))
    UPDATE messages SET created_at=(SELECT json_extract(j,'$.created')+100 FROM seed WHERE json_extract(j,'$.id')=messages.conversation_id)
    WHERE actor_role='contact' AND conversation_id IN (SELECT json_extract(j,'$.id') FROM seed)`),
   query(`INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at)
    SELECT 'answer-'||json_extract(value,'$.id'),'p',json_extract(value,'$.id'),'answer-'||json_extract(value,'$.id'),'owner','owner','Visible answer',2,
     json_extract(value,'$.created')+100+json_extract(value,'$.response') FROM json_each(?)`),
   query(`INSERT INTO conversation_tracking(conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_at,first_resolved_at)
    SELECT json_extract(value,'$.id'),'p',1,1,json_extract(value,'$.created'),json_extract(value,'$.created')+json_extract(value,'$.resolution') FROM json_each(?)`),
   query(`INSERT INTO conversation_resolutions(id,project_id,conversation_id,contact_id,ordinal,resolved_at,resolved_revision,cycle_start_revision,outcome,evidence_json,reopened_at)
    SELECT 'latest-'||json_extract(value,'$.id'),'p',json_extract(value,'$.id'),'visitor',json_extract(value,'$.ordinal'),
     json_extract(value,'$.created')+json_extract(value,'$.resolution')+(json_extract(value,'$.ordinal')-1)*1000,2,0,json_extract(value,'$.outcome'),'{}',
     CASE WHEN json_extract(value,'$.reopened')=1 THEN json_extract(value,'$.created')+json_extract(value,'$.resolution')+2000 END FROM json_each(?)`),
   query(`INSERT INTO conversation_resolutions(id,project_id,conversation_id,contact_id,ordinal,resolved_at,resolved_revision,cycle_start_revision,outcome,evidence_json,reopened_at)
    SELECT 'prior-'||json_extract(value,'$.id'),'p',json_extract(value,'$.id'),'visitor',1,json_extract(value,'$.created')+json_extract(value,'$.resolution'),2,0,
     CASE WHEN json_extract(value,'$.outcome')='ai' THEN 'human' ELSE 'ai' END,'{}',json_extract(value,'$.created')+json_extract(value,'$.resolution')+500
    FROM json_each(?) WHERE json_extract(value,'$.ordinal')=2`),
   query(`INSERT INTO conversation_ratings(resolution_id,value,comment,updated_at,revision)
    SELECT 'latest-'||json_extract(value,'$.id'),json_extract(value,'$.value'),json_extract(value,'$.comment'),json_extract(value,'$.created')+30000000,1
    FROM json_each(?) WHERE json_extract(value,'$.value') IS NOT NULL`),
   query(`INSERT INTO conversation_ratings(resolution_id,value,comment,updated_at,revision)
    SELECT 'prior-'||json_extract(value,'$.id'),CASE WHEN json_extract(value,'$.value')=1 THEN -1 ELSE 1 END,'Prior cycle',1,1
    FROM json_each(?) WHERE json_extract(value,'$.ordinal')=2`)
  ]);
 }
 await h.contact('foreign-visitor','q');
 const sentinels=[
  ['scale-before','p','visitor','2026-03-07T04:59:59Z'],
  ['scale-end','p','visitor','2026-03-10T04:00:00Z'],
  ['scale-imported','p','visitor','2026-03-08T12:00:00Z'],
  ['scale-legacy','p','visitor','2026-03-08T12:00:00Z'],
  ['scale-foreign','q','foreign-visitor','2026-03-08T12:00:00Z']
 ];
 for(const [id,project,contact,date] of sentinels){
  await h.db.prepare('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,project,contact,Date.parse(date),Date.parse(date)).run();
  await h.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'contact','Excluded question',1,?)").bind(id+'-q',project,id,id+'-q',contact,Date.parse(date)).run();
 }
 await h.db.prepare("INSERT INTO move_in_conversations(conversation_id,project_id,vendor,source_id,subject,source_state,source_channel) VALUES('scale-imported','p','intercom','scale-import','Imported','closed','chat')").run();
 await h.db.prepare("INSERT INTO reporting_legacy_conversations VALUES('p','scale-legacy','scale-legacy-run')").run();
 const empty=await h.conversation();
 await h.db.prepare('UPDATE conversations SET created_at=? WHERE id=?').bind(Date.parse('2026-03-08T12:00:00Z'),empty.id).run();
 return {fixtures,emptyId:empty.id};
}
