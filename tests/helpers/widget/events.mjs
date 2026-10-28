import assert from 'node:assert/strict'

export const monitoringProvider=async request=>{
    assert.equal(new URL(request.url).hostname,'api.openai.com');
    const body=await request.json(),name=body.text?.format?.name;
    const evidence=JSON.stringify(body).match(/action:[a-z0-9-]+/)?.[0];
    const value=name==='context_analysis'?{decision:'insight',help_type:'support',evidence_ids:[evidence],help:'Help finding the API credential'}:name==='context_insight'?{content:'Would you like help finding your API credential?',buttons:[{text:'Show me where',action:'send'},{text:'No thanks',action:'close'}],loading:null,evidence_ids:[evidence]}:name==='context_summary'?{summary:'The visitor could not find an API credential in workspace settings.'}:null;
    assert.ok(value,'only the expected monitoring model requests reach the network');
    const text=JSON.stringify(value),events=[{type:'response.output_text.delta',item_id:'msg',delta:text},{type:'response.output_text.done',item_id:'msg',text},{type:'response.completed',response:{usage:{input_tokens:12,output_tokens:4,total_tokens:16,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}}}}];
    return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
 }

// Continue the campaign visitor's own follow-up through insight admission and native monitoring.
export async function widgetEventsJourney({app,workspace,contact,conversation}){
 const db=app.db,p=workspace.projectId,visitor=contact.contactId,own=conversation.id
 await db.exec(`INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('q','Other','other','https://other.example',1);
 INSERT INTO contacts(id,project_id,name,created_at) VALUES('other','${p}','Other',1),('foreign','q','Foreign',1);
 INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('other','${p}','other',1,1),('foreign','q','foreign',1,1),('closed','${p}','${visitor}',1,1);
 UPDATE conversations SET status_id='closed',status_category='closed',resolved_at=1 WHERE id='closed';`)
 const previous=await app.ok(`/api/conversations/${own}`,{token:workspace.tokens.owner})
 await app.call(`/api/dashboard/projects/${p}/conversations/${own}/ticket`,{token:workspace.tokens.owner,method:'PATCH',body:{status_id:'pending',expected_version:previous.ticket_version},status:200})
 const baseline={messages:(await app.first('SELECT count(*) n FROM messages')).n,outbox:(await app.first('SELECT count(*) n FROM conversation_outbox')).n,revision:(await app.first('SELECT revision FROM conversations WHERE id=?',own)).revision}
  const buttons = JSON.stringify([{ id: 'policy', label: 'Show policy', action: 'send', text: 'Show policy' }])
  for (const [id, subject] of [['insight',visitor], ['other-insight','other'], ['closed-insight',visitor]]) {
    await db.prepare('INSERT INTO context_insights VALUES(?,?,?,?,?,?,?,?,NULL)')
      .bind(id, p, subject, 'help', 'How can we help?', buttons, '[]', 1).run()
  }
  // Proactive help is on with a ready assistant, and these visitors consented earlier: insights exist only then.
  await db.prepare(`INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,is_enabled,created_at) VALUES('helper','${p}','Support assistant','Support','Help the visitor','gpt-5.6-luna',1,1)`).run()
  await app.call(`/api/management/projects/${p}/settings`,{token:workspace.tokens.owner,method:'PUT',body:{is_contact_tracking_enabled:true,proactive_help_enabled:true},status:200})
  await app.call(`/api/management/projects/${p}/ai`,{token:workspace.tokens.owner,method:'PUT',body:{default_visitor_ai_id:'helper'},status:200})
  await db.prepare(`UPDATE context_subjects SET consent=1,bot_enabled=1 WHERE subject_id IN ('${visitor}','other')`).run()
  async function call(action, data = {}, conversation = own, token = contact.token, headers = {}) {
    return app.request(`/api/conversations/${conversation}/widget-events`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers }, body: { action, data },
    })
  }
  const insightCommand = { insight_id: 'insight', button_id: 'policy', ai_message: { local_id: 'insight-ai' }, local_id: 'insight-contact' }
  for (const conversation of ['other', 'foreign', 'missing']) {
    for (const [action, data] of [['contact', { name: 'Forged' }], ['markAsRead', {}], ['useInsight', insightCommand], ['insights', {}], ['request', { requestId: 'foreign-request' }]]) {
      assert.equal((await call(action, data, conversation)).status, 404, `${action} denies ${conversation}`)
    }
  }
  assert.equal((await call('contact', {}, own, workspace.tokens.owner)).status, 403)
  assert.equal((await call('contact', {}, own, 'invalid-token')).status, 401)
  assert.equal((await call('unknown')).status, 400)
  assert.equal((await call('useInsight', { ...insightCommand, insight_id: 'other-insight' })).status, 404)
  assert.equal((await call('useInsight', { ...insightCommand, button_id: 'forged' })).status, 400)
  assert.equal((await call('useInsight', { ...insightCommand, ai_message: {} })).status, 400)
  assert.equal((await db.prepare('SELECT count(*) n FROM messages').first()).n, baseline.messages)

  const admitted = await call('useInsight', insightCommand)
  assert.equal(admitted.status, 200, await admitted.clone().text())
  assert.equal((await admitted.json()).duplicate, false)
  const replay = await call('useInsight', insightCommand)
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).duplicate, true)
  assert.equal((await db.prepare('SELECT count(*) n FROM messages').first()).n, baseline.messages+2)
  assert.equal((await db.prepare('SELECT count(*) n FROM conversation_outbox').first()).n, baseline.outbox+2)
  assert.equal((await db.prepare(`SELECT revision FROM conversations WHERE id='${own}'`).first()).revision, baseline.revision+2)
  // The visitor's choice is a customer reply: Pending returns to Open, attributed to the visitor.
  assert.equal((await db.prepare(`SELECT status_category FROM conversations WHERE id='${own}'`).first()).status_category, 'open')
  assert.ok(await db.prepare(`SELECT 1 FROM ticket_history WHERE conversation_id='${own}' AND actor_id='${visitor}' AND actor_type='contact' AND source='customer_reply' AND json_extract(changes_json,'$.status_id.to')='open'`).first())
  assert.equal((await call('useInsight', { ...insightCommand, local_id: 'different-contact' })).status, 409)
  // On a Closed ticket the choice opens a new ticket for the visitor, and a replay returns to it.
  const closedCommand = { insight_id: 'closed-insight', button_id: 'policy', ai_message: { local_id: 'closed-ai' }, local_id: 'closed-contact' }
  const followed = await (await call('useInsight', closedCommand, 'closed')).json()
  assert.equal(followed.accepted, true); assert.notEqual(followed.conversationId, 'closed')
  assert.equal((await db.prepare('SELECT contact_id FROM conversations WHERE id=?').bind(followed.conversationId).first()).contact_id, visitor)
  assert.equal((await db.prepare('SELECT count(*) n FROM messages WHERE conversation_id=?').bind(followed.conversationId).first()).n, 2)
  const followReplay = await (await call('useInsight', closedCommand, 'closed')).json()
  assert.equal(followReplay.duplicate, true); assert.equal(followReplay.conversationId, followed.conversationId)
  assert.equal((await db.prepare("SELECT revision,status_category FROM conversations WHERE id='closed'").first()).status_category, 'closed')
  assert.equal((await call('markAsRead')).status, 200)
  assert.equal((await db.prepare(`SELECT revision FROM conversation_reads WHERE conversation_id='${own}'`).first()).revision, baseline.revision+2)
  assert.equal((await call('instruction', { opened: false })).status, 200)
  assert.equal(JSON.parse((await db.prepare(`SELECT metadata_json FROM contacts WHERE id='${visitor}'`).first()).metadata_json).widget_opened, false)
  await db.prepare(`UPDATE contacts SET metadata_json=json_set(metadata_json,'$.provided_name','Collected name','$.business',json('{"plan":"plus"}')) WHERE id='${visitor}'`).run()
  assert.equal((await call('instruction',{opened:true,timezone:'America/New_York',language:'en-us',ip_address:'forged',country_code:'ZZ',user_agent:'forged',last_seen_at:1},own,contact.token,{'CF-Connecting-IP':'2001:db8::1','CF-IPCountry':'US','User-Agent':'Observed Presence/1.0'})).status,200)
  const observed=JSON.parse((await db.prepare(`SELECT metadata_json FROM contacts WHERE id='${visitor}'`).first()).metadata_json)
  assert.equal(observed.timezone,'America/New_York');assert.equal(observed.language,'en-US');assert.equal(observed.ip_address,'2001:db8::1');assert.equal(observed.country_code,'US');assert.equal(observed.user_agent,'Observed Presence/1.0');assert.equal(observed.widget_opened,true);assert.ok(observed.last_seen_at>1);assert.equal(observed.provided_name,'Collected name');assert.deepEqual(observed.business,{plan:'plus'})
  assert.equal((await call('instruction',{timezone:'not-a-timezone',language:'not_a_language',ip_address:'forged'},own,contact.token,{'CF-Connecting-IP':'2001:db8::1','CF-IPCountry':'US','User-Agent':'Observed Presence/1.0'})).status,200)
  const retained=JSON.parse((await db.prepare(`SELECT metadata_json FROM contacts WHERE id='${visitor}'`).first()).metadata_json)
  for(const key of ['timezone','language','ip_address','country_code','user_agent','provided_name','business'])assert.deepEqual(retained[key],observed[key])


  // Every new request rechecks live authority, including previously accepted commands.
  await db.prepare(`UPDATE contacts SET metadata_json=? WHERE id='${visitor}'`).bind('{"is_blocked":true}').run()
  assert.equal((await call('useInsight', insightCommand)).status, 401)
  assert.equal((await call('pingActive')).status, 401)
  await db.exec(`UPDATE contacts SET metadata_json='{}' WHERE id='${visitor}'; UPDATE conversations SET contact_id='other' WHERE id='${own}';`)
  assert.equal((await call('useInsight', insightCommand)).status, 404)
  await db.exec(`UPDATE conversations SET contact_id='${visitor}',assigned_to='${workspace.users.owner}' WHERE id='${own}';`)
  assert.equal((await call('assignAi')).status, 409)
  await db.exec(`UPDATE conversations SET assigned_to=NULL WHERE id='${own}';`)
  assert.equal((await call('assignAi', { ai_id: 'missing' })).status, 400)
  assert.equal((await call('useInsight', { ...insightCommand, close: true })).status, 200)
  assert.equal((await call('useInsight', insightCommand)).status, 404)
  // A fresh subject opts in through the real visitor command; no operator SQL consent seed.
  const actions=Array.from({length:7},(_,i)=>({localId:`settings-action-${i}`,action:`Tried to find the API credential in workspace settings step ${i}`}))
  await db.prepare(`UPDATE context_subjects SET consent=0,bot_enabled=0 WHERE subject_id='${visitor}'`).run()
  assert.equal((await (await call('collector',actions)).json()).accepted,0,'collection is refused before visitor consent')
  assert.notEqual((await (await call('contextConsent')).json()).monitoring.consent,true)
  assert.equal((await (await call('contextConsent',{consent:true})).json()).monitoring.enabled,true)
  const collection=await (await call('collector',actions)).json()
  assert.ok(collection.accepted>0)
  assert.ok(collection.job.id,'accepted activity queues the selected native model')
  // The queued monitoring run executes as the queue would.
  for(const job of await app.takeJobs())if(job.type==='context.run')await app.runJobs([job])
  const generated=await db.prepare('SELECT state,error FROM context_jobs WHERE id=?').bind(collection.job.id).first()
  assert.equal(generated.state,'completed',generated.error)
  const offer=(await (await call('insights')).json()).insights[0]
  assert.ok(offer.metadata.buttons.some(button=>button.action==='send'))
  assert.equal(offer.ai.id,'helper')
  await db.prepare("UPDATE ai_profiles SET model='claude-haiku-4-5-20251001' WHERE id='helper'").run()
  assert.deepEqual((await (await call('insights')).json()).insights,[],'no proactive offer when the reply assistant lacks its provider key')
  await db.prepare("UPDATE ai_profiles SET model='gpt-5.6-luna' WHERE id='helper'").run()
  assert.equal((await call('useInsight',{insight_id:offer.id,close:true})).status,200)
  assert.ok(!(await (await call('insights')).json()).insights.some(item=>item.id===offer.id),'dismissal survives subsequent retrieval')
  await call('contextConsent',{consent:false})
  assert.equal((await (await call('collector',actions.map(row=>({...row,localId:'revoked-'+row.localId})))).json()).accepted,0,'withdrawal stops collection')
  assert.deepEqual((await (await call('insights')).json()).insights,[])
  // The visitor's ordinary responder selector resumes the same waiting turn once.
  assert.equal((await call('assignAi',{ai_id:'helper'})).status,200)
  const handoff=await db.prepare(`SELECT id,state FROM ai_generations WHERE conversation_id='${own}' AND kind='reply'`).first()
  assert.ok(handoff?.id)
  assert.equal(handoff.state,'queued')
  assert.equal((await call('assignAi',{ai_id:'helper'})).status,200)
  assert.deepEqual(await db.prepare(`SELECT id,state FROM ai_generations WHERE conversation_id='${own}' AND kind='reply'`).all().then(result=>result.results),[handoff],'repeating a visitor handoff preserves one queued reply')
  const settings=await db.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(p).first()
  await db.prepare("UPDATE project_settings SET settings_json=json_set(settings_json,'$.deleted_at',1) WHERE project_id=?").bind(p).run()
  assert.equal((await call('markAsRead')).status,401)
  await db.prepare('UPDATE project_settings SET settings_json=? WHERE project_id=?').bind(settings.settings_json,p).run()
  assert.equal((await db.prepare('SELECT state FROM ai_generations WHERE id=?').bind(handoff.id).first()).state,'queued','authority refusals do not alter the admitted handoff')
  // The next stage is the same visitor receiving a human reply, after this handoff.
  await app.call(`/api/conversations/${own}/widget-events`,{token:contact.token,body:{action:'assignAi',data:{ai_id:null}},status:200})
}
