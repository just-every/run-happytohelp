import assert from 'node:assert/strict';
import {readdir,readFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {createPortability} from '@runeditrun/rer/modules/portability';
import {exportArchive,importArchive} from '@runeditrun/rer/modules/portability/files';
import {migrationReplay} from '@runeditrun/rer/modules/portability/migration-history';
import {splitSqlStatements} from '../../../scripts/delivery/base/sql-statements.mjs';
import {archivePolicy} from '../../../scripts/installer/portability-policy.mjs';
import {sha} from '../../journeys/kit/app.mjs';
// The production archive file door, with real D1/R2 and the channel's network-edge provider.
export async function restoreConsent(harness){
 const directory=await mkdtemp(join(tmpdir(),'happytohelp-channel-restore-'));let source,target;
 try{
  source=await harness();const c=await source.connect('sms');await source.deliver(c,'sms',source.event('sms',{text:'STOP'}));const t=await source.ticket(c);const held=await source.reply(t);await source.deliver(c,'sms',source.event('sms',{sender:'+12025550125'}));const previouslyActive=await source.ticket(c);await source.reply(previouslyActive);
  const wa=await source.connect('whatsapp'),agreement=source.event('whatsapp',{text:'I agree to WhatsApp support updates'});await source.deliver(wa,'whatsapp',agreement);const waThread=await source.ticket(wa);
  const plan=await Promise.all((await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort().map(async name=>({name,statements:splitSqlStatements(await readFile(join('migrations',name),'utf8'))})));
  const service=async app=>createPortability({db:app.db,buckets:{FILES:await app.files},policy:archivePolicy,migrations:async()=>migrationReplay(plan,archivePolicy)});
  const path=join(directory,'support.jsonl');await exportArchive(await service(source.app),path,[]);
  const restored={ws:source.ws,other:source.other};await source.close();source=null;
  target=await harness({restored});await importArchive(await service(target.app),path,[]);
  // Restore only the test owner's authentication after the production importer strips sessions.
  const token=target.token,user=target.ws.users.owner,now=Date.now();await target.app.db.batch([
   target.app.db.prepare('INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,?,?)').bind(sha(token),user,target.ws.projectId,'owner',now+3600000),
   target.app.db.prepare("INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES(?,?,'password',?)").bind(sha(token),user,now),
  ]);
  assert.equal((await target.deliver(c,'sms',target.event('sms'))).status,410);
  await target.connect('sms');await target.reply(previouslyActive);assert.match((await target.call('/conversations/'+previouslyActive.conversation_id)).data.blocked,/customer_opted_out/,'import does not restore an earlier active consent');await target.reply(t);let status=(await target.call('/conversations/'+t.conversation_id)).data;assert.match(status.blocked,/customer_opted_out/);assert.ok(status.sends.every(s=>s.state==='blocked'));
  await target.deliver(c,'sms',target.event('sms',{text:'START'}));assert.equal((await target.call('/conversations/'+t.conversation_id)).data.blocked,null);await target.app.scheduled();assert.equal(target.sends.length,0);assert.equal((await target.call('/conversations/'+t.conversation_id)).data.sends.find(s=>s.message_id===held.message.id).state,'blocked');
  await target.reply(t,{content:'Reviewed after a new customer START'});assert.equal(target.sends.length,1);
  await target.connect('whatsapp');await target.deliver(wa,'whatsapp',target.event('whatsapp',{text:'START'}));await target.deliver(wa,'whatsapp',agreement);const waStatus=()=>target.call('/conversations/'+waThread.conversation_id);assert.equal((await waStatus()).data.template_consent,false,'replaying an archived agreement cannot restore continuation consent');
  await target.deliver(wa,'whatsapp',target.event('whatsapp',{text:'I agree to WhatsApp support updates'}));assert.equal((await waStatus()).data.template_consent,true);assert.equal(target.sends.length,1,'fresh agreement never sends a continuation automatically');

 }finally{await source?.close();await target?.close();await rm(directory,{recursive:true,force:true});}
}

// Run the real archive journey without leaking Wrangler's HTTP dispatcher into its caller.
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const {channelHarness}=await import('./journeys.mjs');
 await restoreConsent(channelHarness);
}
