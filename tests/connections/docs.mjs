import {phases} from '../journeys/kit/scenarios.mjs';const test=phases(import.meta.url);import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {spawn} from 'node:child_process';
import {harness,body} from './harness.mjs';
test('every documented curl block executes against the local Worker with secret config on stdin and native effects',async()=>{
 const h=await harness();try{
  await h.contact();const conversation=await h.conversation();const article=await h.call('/api/knowledge/p/articles',body({title:'Initial Guide',slug:'initial-guide',content:'Original',status:'draft'}));const {token}=await h.issue();
  const markdown=await readFile('docs/api.md','utf8'),blocks=[...markdown.matchAll(/```sh\n([\s\S]*?)\n```/g)].map(m=>m[1]);assert.ok(blocks.length,'documented operations exist');
  const results=[];
  for(const command of blocks){assert.match(command,/curl --silent --show-error --config -/);const result=await new Promise((resolve,reject)=>{
   // No shell -c command argument contains credentials. The actual documented
   // command is fed on stdin; here-doc expansion feeds private curl config.
   const child=spawn('/bin/bash',[],{cwd:process.cwd(),env:{...process.env,H2H_URL:h.url.replace(/\/$/,''),H2H_TOKEN:token,CONVERSATION_ID:conversation.id,CONTACT_ID:'visitor',ARTICLE_ID:article.id,REVISION:'0'},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));child.stdin.end(command+'\n');
  });assert.equal(result.code,0,'documented curl exit');assert.equal(result.stderr,'','curl runs without diagnostics');assert.ok(!result.stdout.includes(token),'no token disclosure');const data=JSON.parse(result.stdout);assert.ok(!data.error,'documented call succeeds');results.push(data)}
  assert.equal(results[0].data.length,1);assert.equal(results[1].data.id,conversation.id);assert.equal(results[2].data.length,0);assert.equal(results[3].data.content,'We have received your request.');assert.equal(results[3].data.revision,1);assert.ok(results[4].data.id);assert.equal(results[5].data.length,1);assert.equal(results[6].data.id,'visitor');assert.equal(results[7].data.name,'Documentation Contact');assert.equal(results[8].data.name,'Updated Contact');assert.equal(results[9].data.length,1);assert.equal(results[10].data.id,article.id);assert.ok(results[11].data.id);assert.equal(results[12].data.id,article.id);
  assert.deepEqual(await h.db.prepare('SELECT title,content,status FROM knowledge_articles WHERE id=?').bind(article.id).first(),{title:'Published Guide',content:'Published guide body',status:'published'});
  assert.equal((await h.db.prepare("SELECT count(*) n FROM knowledge_articles WHERE slug='documentation-draft' AND status='draft'").first()).n,1);
  const publicDraft=await h.raw('/api/knowledge/public/p/articles/documentation-draft',{token:null});assert.equal(publicDraft.status,404);assert.equal((await h.raw('/api/knowledge/public/p/articles/initial-guide',{token:null})).status,200);
  assert.equal((await h.db.prepare('SELECT count(*) n FROM messages WHERE conversation_id=?').bind(conversation.id).first()).n,1);assert.equal((await h.db.prepare('SELECT count(*) n FROM conversation_resolutions WHERE conversation_id=?').bind(conversation.id).first()).n,1);
 }finally{await h.close()}
});
