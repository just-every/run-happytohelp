export function storageViews(app){
 const all=app.sql,one=app.first
 const objectText=async key=>{const object=await(await app.files).get(key);return object?object.text():null}
// Everything outside the erased contact's scope; context_subjects.revision is a
// project-wide cache counter that message-content triggers deliberately bump.
async function outsideScope(){
 const snapshot={
  contacts:await all("SELECT * FROM contacts WHERE id<>'ct' ORDER BY id"),
  sessions:await all("SELECT * FROM sessions WHERE contact_id IS NULL OR contact_id<>'ct' ORDER BY token_hash"),
  conversations:await all("SELECT * FROM conversations WHERE id NOT IN ('conv1','conv2') ORDER BY id"),
  outbox:await all("SELECT * FROM conversation_outbox WHERE conversation_id NOT IN ('conv1','conv2') ORDER BY id"),
  messages:await all("SELECT * FROM messages WHERE conversation_id NOT IN ('conv1','conv2') ORDER BY id"),
  media:await all("SELECT * FROM media WHERE id NOT IN ('md1','md2') ORDER BY id"),
  notes:await all("SELECT * FROM conversation_notes WHERE conversation_id NOT IN ('conv1','conv2') ORDER BY id"),
  participants:await all("SELECT * FROM conversation_participants WHERE contact_id<>'ct' ORDER BY id"),
  reads:await all("SELECT * FROM conversation_reads WHERE user_id<>'ct' ORDER BY conversation_id,user_id"),
  subjects:await all("SELECT project_id,subject_id,consent,help_types,bot_enabled FROM context_subjects WHERE NOT (project_id='p' AND subject_id='ct') ORDER BY project_id,subject_id"),
  generations:await all("SELECT * FROM ai_generations WHERE conversation_id NOT IN ('conv1','conv2') ORDER BY id"),
  attemptEvents:await all("SELECT * FROM ai_attempt_events WHERE attempt_id<>'att-run' ORDER BY id"),
  usage:await all('SELECT * FROM ai_round_usage ORDER BY attempt_id,request_id'),
  localJobs:await all("SELECT * FROM local_jobs WHERE id<>'job1' ORDER BY id"),
  localEvents:await all("SELECT * FROM local_events WHERE job_id<>'job1'"),
  replyGrants:await all("SELECT * FROM email_reply_grants WHERE token_hash IN ('reply-bob','reply-q') ORDER BY token_hash"),
  email:await all("SELECT * FROM email_deliveries WHERE id='message:mo1:x'"),
  legacy:await all("SELECT * FROM legacy_import_rows WHERE source_id IN ('other','bucketOther') ORDER BY source_id"),
  buckets:await all("SELECT * FROM conversation_buckets WHERE conversation_id NOT IN ('conv1','conv2') ORDER BY id"),
  inbound:await all("SELECT * FROM inbound_emails WHERE id IN ('seed-in-other','seed-in-q') ORDER BY id"),
  objects:Object.fromEntries(await Promise.all(['p/convOther/other-upload','q/convQ/q-upload','q/convQ/q-by-ct'].map(async key=>[key,await objectText(key)]))),
 }
 for(const table of ['context_evidence','context_profiles','context_insights','context_summaries','context_collectors','context_actions','context_tracked_events','context_jobs'])snapshot[table]=await all(`SELECT * FROM ${table} WHERE NOT (project_id='p' AND subject_id='ct') ORDER BY 1,2,3`)
 snapshot.contextJobEvents=await all("SELECT * FROM context_job_events WHERE job_id<>'cj1'")
 return snapshot
}

// Every row or object that held the erased contact's personal data.
async function erasedScope(){
 return {
  contact:await one("SELECT * FROM contacts WHERE id='ct'"),
  sessions:await all("SELECT * FROM sessions WHERE contact_id='ct'"),
  messages:await all("SELECT id,local_id,actor_id,actor_role,content,revision,intent_hash,erased_at IS NOT NULL erased FROM messages WHERE conversation_id IN ('conv1','conv2') ORDER BY id"),
  media:await all("SELECT * FROM media WHERE id IN ('md1','md2')"),
  objects:await Promise.all(['p/conv1/contact-upload','p/conv2/operator-upload','delegation/p/job1/shot'].map(objectText)),
  notes:await all("SELECT * FROM conversation_notes WHERE conversation_id IN ('conv1','conv2')"),
  participants:await all("SELECT * FROM conversation_participants WHERE contact_id='ct'"),
  reads:await all("SELECT * FROM conversation_reads WHERE user_id='ct'"),
  context:Object.fromEntries(await Promise.all(['context_subjects','context_evidence','context_profiles','context_insights','context_summaries','context_collectors','context_actions','context_tracked_events','context_jobs'].map(async table=>[table,(await one(`SELECT count(*) n FROM ${table} WHERE project_id='p' AND subject_id='ct'`)).n]))),
  contextJobEvents:await all("SELECT * FROM context_job_events WHERE job_id='cj1'"),
  generations:await all("SELECT id,state,instruction,output_json,options_json FROM ai_generations WHERE conversation_id='conv1' ORDER BY id"),
  buckets:await all("SELECT * FROM conversation_buckets WHERE conversation_id IN ('conv1','conv2') ORDER BY id"),
  attemptEvents:await all("SELECT type,event_json FROM ai_attempt_events WHERE attempt_id='att-run' ORDER BY id"),
  localJob:await one("SELECT status,cancel_requested,instructions,context,result FROM local_jobs WHERE id='job1'"),
  localEvents:await all("SELECT payload FROM local_events WHERE job_id='job1'"),
  localAttachments:await all("SELECT * FROM local_attachments WHERE job_id='job1'"),
  localGrants:await all("SELECT * FROM local_attachment_grants WHERE job_id='job1'"),
  localEffect:await one("SELECT payload,state FROM local_result_effects WHERE job_id='job1'"),
  localReceipt:await one("SELECT review_message FROM local_receipts WHERE job_id='job1'"),
  email:await all("SELECT id,recipient FROM email_deliveries WHERE id IN ('message:m1b:notification','transcript-key') ORDER BY id"),
  legacy:await all("SELECT source_id,row_digest,source_json FROM legacy_import_rows WHERE source_id IN ('bucket1','ct','m1a','old-p') ORDER BY source_id"),
  inbound:await all("SELECT id,automatic,evidence_json,local_id,message_id FROM inbound_emails WHERE id IN ('seed-in-conv','seed-in-sender') ORDER BY id"),
  staged:await all('SELECT * FROM contact_erasure_objects'),
  rawContent:await all("SELECT content_raw FROM messages WHERE conversation_id IN ('conv1','conv2')"),
  ratings:await all("SELECT comment FROM conversation_ratings WHERE resolution_id='resolution-alice' UNION ALL SELECT comment FROM conversation_rating_history WHERE resolution_id='resolution-alice'"),
 }
}

 return {outsideScope,erasedScope}
}
