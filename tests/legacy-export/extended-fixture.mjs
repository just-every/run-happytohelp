import {createCipheriv} from 'node:crypto';

const uuid = (group, number) => `${group}000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const timestamp = '2026-01-15 09:30:00';
const times = {created_at: timestamp, updated_at: timestamp};
const json = JSON.stringify;
const actionPlaintext = 'fixture-private-collected-action';
const cipher = createCipheriv('aes-256-cbc', Buffer.alloc(32, 11), Buffer.alloc(16, 7));
const encryptedAction = Buffer.concat([cipher.update(actionPlaintext), cipher.final()]).toString('base64');

// Every value here is synthetic. Scan all artifacts and native stores, not only
// the archive table that exposed the original connection-key regression.
export const PLANTED_SECRETS = Object.freeze([
  'fixture-profile-known-credential','synthetic-fixture-reply-cache-credential','fixture-suggestion-cache-credential','fixture-transcript-environment-value','fixture-contact-admin-capability','fixture-password-hash', 'fixture-remember-token', 'fixture-contact-key-hash',
  ...['paper-lantern', 'orbit-repairs'].flatMap(slug => [`fixture-verification-${slug}`, `fixture-invitation-${slug}`]),
  'fixture-connection-shared-key', 'fixture-contact-shared-key', 'fixture-github-access-token',
  'fixture-asymmetric-private-key', 'fixture-asymmetric-public-key',
  'fixture-contact-shared-hash', 'fixture-contact-shared-salt',
  'fixture-crawl-exception-credential','fixture-crawl-webhook-token','fixture-refresh-claim-token','fixture-device-token-hash','fixture-grant-token-hash','fixture-personal-access-token',
  'fixture-password-reset-token', 'fixture-message-thinking-signature', 'fixture-event-contact-hash', 'fixture-event-contact-admin-capability', actionPlaintext, encryptedAction,
]);

export async function seedExtendedLegacy(insert, {projectId, n, slug, name, ownerId, aiId, contactId, conversationId, bucketId, messageId}) {
  const sharedKeyId = uuid('93', n);
  const grantId=uuid('b1',n),deviceId=uuid('b2',n),delegationId=uuid('b3',n);
  await insert('local_agent_grants',{id:grantId,project_id:projectId,operator_id:ownerId,token_hash:'fixture-grant-token-hash-'+n,...times});
  await insert('local_agent_devices',{id:deviceId,project_id:projectId,operator_id:ownerId,local_agent_grant_id:grantId,name:'Support laptop',provider:'codex',capabilities:json(['investigate']),token_hash:'fixture-device-token-hash-'+n,...times});
  await insert('local_agent_device_project_settings',{id:uuid('b4',n),project_id:projectId,local_agent_device_id:deviceId,working_directories:json(['/workspace/support']),...times});
  await insert('support_delegations',{id:delegationId,project_id:projectId,conversation_id:conversationId,local_agent_device_id:deviceId,created_by_user_id:ownerId,request_id:uuid('b5',n),mode:'investigate',instructions:'Inspect this invoice',status:'running',...times});
  await insert('support_delegation_events',{id:uuid('b6',n),support_delegation_id:delegationId,created_by_user_id:ownerId,event_type:'progress',message:'Reading invoice details',payload:json({step:1}),created_at:timestamp});
  await insert('events',{id:uuid('b7',n),conversation_id:conversationId,bucket_id:bucketId,agent_id:ownerId,type:'AGENT_ASSIGNED',payload:json({name:'Export Owner',is_ai:false}),created_at:timestamp});
  // Live USED_INSIGHT shape: the widget snapshots the contact, metadata included.
  await insert('events',{id:uuid('b8',n),conversation_id:conversationId,bucket_id:bucketId,type:'USED_INSIGHT',payload:json({insight_id:uuid('a3',n),close:true,contact_message:{content:'Where is my invoice?',contact:{name,email:`customer@${slug}.example.test`,identifier:`customer-${n}`,hash:'fixture-event-contact-hash',metadata:{plan:'business',admin:'fixture-event-contact-admin-capability',signed_up_at:'2025-01-01',hash:'fixture-event-contact-hash'}}},ai_message:{content:'Your invoice is in Billing.'}}),created_at:timestamp});

  await insert('asymmetric_keys', {id:uuid('92', n),project_id:projectId,contact_id:contactId,
    public_key:'fixture-asymmetric-public-key',private_key:'fixture-asymmetric-private-key',...times});
  await insert('contact_shared_keys', {id:sharedKeyId,project_id:projectId,contact_id:contactId,
    last_connection_id:`fixture-connection-${n}`,hash:'fixture-contact-shared-hash',salt:'fixture-contact-shared-salt',...times});
  await insert('connections', {id:`fixture-connection-${n}`,project_id:projectId,contact_id:contactId,conversation_id:conversationId,
    shared_key:'fixture-connection-shared-key',contact_shared_key:'fixture-contact-shared-key',contact_shared_key_id:sharedKeyId,
    page_content:'<main>Customer billing dashboard</main>',...times});
  await insert('collectors', {id:uuid('94', n),project_id:projectId,contact_id:contactId,
    data:json({pages:[`https://${slug}.example.test/billing`]}),actions_count:5,summary_count:1,analysis_count:2,...times});
  await insert('collector_actions', {id:uuid('95', n),project_id:projectId,contact_id:contactId,
    contact_shared_key_id:sharedKeyId,action:encryptedAction,...times});
  await insert('collector_summaries', {id:uuid('96', n),project_id:projectId,contact_id:contactId,
    summary:'Customer is reading the billing guide.',metadata:json({page:'billing'}),total_actions:5,total_pages:1,total_summaries:1,...times});
  await insert('project_github_connections', {id:uuid('97', n),project_id:projectId,github_user_id:1000+n,
    github_login:`${slug}-operator`,access_token:'fixture-github-access-token',scopes:json(['repo']),connected_at:timestamp,...times});
  await insert('plugins', {id:uuid('98', n),project_id:projectId,name:'Customer billing',url:`https://${slug}.example.test/billing`,position:2,
    created_by_id:ownerId,modified_by_id:ownerId,...times});
  await insert('categories', {id:uuid('77', n),project_id:projectId,title:'Account overview',slug:'account-overview',
    _lft:5,_rgt:6,created_by_id:ownerId,published_at:timestamp,...times});
  for (const [offset, settings] of [[0,{excluded_urls:`https://${slug}.example.test/private\nhttps://${slug}.example.test/admin`,max_crawl_depth:7,max_crawl_pages:43}],
    [1,{excluded_urls:'',max_crawl_depth:0,max_crawl_pages:0}]]) {
    const datasetId=uuid(offset?'a1':'a0',n);
    await insert('datasets', {id:datasetId,project_id:projectId,url:`https://${slug}.example.test/${offset?'empty':'help'}`,
      status_message:'fixture-crawl-exception-credential',crawl_webhook_token:'fixture-crawl-webhook-token',refresh_claim_token:'fixture-refresh-claim-token',refresh_mode:'manual',refresh_unchanged_count:2,
      status:offset?'created':'ready',pages_count:offset?0:1,metadata:json({purpose:'support'}),...settings,...times});
    if (!offset) await insert('dataset_files', {id:uuid('a2',n),project_id:projectId,dataset_id:datasetId,
      url:`https://${slug}.example.test/help/billing`,original_url:`https://${slug}.example.test/help/billing`,
      title:`${name} billing page`,rank:1,html:'<p>Billing documentation</p>',markdown:'Billing documentation',...times});
  }
  for (const [group, closed] of [['a3',true],['a4',false]]) {
    await insert('insights', {id:uuid(group,n),project_id:projectId,contact_id:contactId,ai_id:aiId,ai_type:'support',
      content:closed?'Billing question resolved':'Customer needs billing guidance',metadata:json({topic:'billing',closed}),
      analysis:json({reason:'Visited the billing guide',confidence:0.8}),activated_at:'2026-01-15 09:35:00',
      closed_at:closed?'2026-01-15 09:40:00':null,...times});
  }
  await insert('ai_usages', {id:uuid('a5',n),project_id:projectId,contact_id:contactId,tag:'reply',model:'gpt-5.6-luna',
    usage:json({prompt_tokens:12,completion_tokens:8}),cost:'0.000120',created_at:timestamp});
  await insert('ai_logs', {id:uuid('a6',n),project_id:projectId,ai_usage_id:uuid('a5',n),tag:'reply',model:'gpt-5.6-luna',
    request:json({messages:[{role:'user',content:'Explain this invoice'}]}),response:json({content:'Please open your billing guide.'}),created_at:timestamp});
  await insert('project_optimizations', {id:uuid('a7',n),project_id:projectId,metadata:json({status:'reviewed'}),...times});
  await insert('message_thinkings', {id:uuid('a8',n),project_id:projectId,conversation_id:conversationId,message_id:messageId,
    seq:1,model:'gpt-5.6-luna',content:'Consult the billing guide.',signature:'fixture-message-thinking-signature',created_at:timestamp});
  await insert('leads', {id:uuid('a9',n),project_id:projectId,source:'website',website:`https://${slug}.example.test`,
    website_html:'<h1>Support</h1>',email:`lead@${slug}.example.test`,name:'Alex Prospect',subject:'Product help',content:'Please explain setup.',...times});
  await insert('charges', {id:uuid('b0',n),project_id:projectId,amount:'25.50',status:'succeeded',receipt_url:`https://${slug}.example.test/receipt`,...times});
}
