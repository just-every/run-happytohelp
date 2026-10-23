import assert from 'node:assert/strict'
// Preconditions for the public rer export/import journey, including the durable
// claim before a provider call. Actual source capture/handoff is proved by the route journey.
export async function seedCampaignArchive({DB}){
 await DB.batch([
 DB.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('archive-feedback-ticket','archive-project','archive-contact',1,1)"),
 DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('archive-feedback-quote','archive-project','archive-feedback-ticket','quote','archive-contact','contact','synthetic-happytohelp-6: retained feedback quote',1,1)"),
 DB.prepare("INSERT INTO feedback_sources(id,project_id,conversation_id,contact_id,message_id,quote,penny_url,issue_url,subscribed,preference_message_id,created_by,created_at) VALUES('archive-feedback-source','archive-project','archive-feedback-ticket','archive-contact','archive-feedback-quote','synthetic-happytohelp-6: retained feedback quote','https://penny.example.com/portal/feedback/export','https://vector.example.com/issues/export',1,'archive-feedback-quote','archive-operator',1)"),
 DB.prepare("INSERT INTO feedback_connections VALUES('archive-project','synthetic-happytohelp-6-encrypted-release-secret',1)"),
 DB.prepare("INSERT INTO feedback_penny_connections VALUES('archive-project','https://penny.example.com','synthetic-happytohelp-7-encrypted-penny-key',1)"),
 DB.prepare("INSERT INTO feedback_release_events VALUES('archive-feedback-release','archive-project','release',?,'https://vector.example.com/issues/export','https://releases.example.com/export',1,1)").bind('0'.repeat(64)),
 DB.prepare("INSERT INTO feedback_updates(id,project_id,source_id,release_id,content,state,approved_by,approved_at,created_at) VALUES('archive-feedback-update','archive-project','archive-feedback-source','archive-feedback-release','synthetic-happytohelp-8: approved service update','approved','archive-operator',1,1)"),
 DB.prepare("INSERT INTO feedback_handoffs VALUES('archive-feedback-source','archive-project',?,'sending','archive-operator','archive-feedback-quote',1,NULL)").bind('1'.repeat(64)),
 DB.prepare("INSERT INTO feedback_penny_requesters VALUES('archive-project','archive-contact',NULL,'archive-feedback-source')"),
 DB.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('archive-assurance','Isolated qualification','archive-assurance-widget','https://example.test',1)"),
 DB.prepare("INSERT INTO assurance_profiles(project_id,requested_at,partner,deployment_ref,timezone,updated_by,updated_at) VALUES('archive-assurance',1,'US qualification partner','synthetic-happytohelp-9-isolated-deployment','America/New_York','archive-operator',1)"),
 DB.prepare("INSERT INTO assurance_evidence VALUES('archive-dpa','archive-assurance','dpa','US provider','https://evidence.example.com/dpa','archive-operator',1,1,?,'executed','{}',NULL)").bind(Date.now()+86400000),
 ])
}
export async function assertCampaignArchive({DB}){
 const one=(sql)=>DB.prepare(sql).first()
 assert.equal((await one('SELECT secret_cipher FROM feedback_connections')).secret_cipher,null,'release credential never restores')
 assert.equal((await one('SELECT token_cipher FROM feedback_penny_connections')).token_cipher,null,'Penny credential never restores')
 assert.equal((await one('SELECT subscribed FROM feedback_sources')).subscribed,0,'a restored source needs new subscription authority')
 assert.equal((await one('SELECT state FROM feedback_updates')).state,'cancelled','a restored approval cannot send')
 assert.equal((await one('SELECT state FROM feedback_handoffs')).state,'uncertain','interrupted external actions never replay after restore')
 assert.equal((await one('SELECT quote FROM feedback_sources')).quote,'synthetic-happytohelp-6: retained feedback quote')
 assert.equal((await one('SELECT currency FROM assurance_profiles')).currency,'USD')
 assert.equal((await one('SELECT recording_enabled FROM assurance_profiles')).recording_enabled,0)
 assert.equal((await one('SELECT status FROM assurance_evidence')).status,'executed')
}
