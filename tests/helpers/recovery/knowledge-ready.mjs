import assert from 'node:assert/strict';

// A sanitized restore has no local canonicalisation proof. Exercise its public
// maintenance boundary while the packaged Worker's real queue rebuilds it.
export async function restoredKnowledgeReady(runtime,projectId,slug='recovery-fixture'){
 await conversionReady(`${runtime.origin}/api/knowledge/public/${projectId}/articles/${encodeURIComponent(slug)}`);
}

// Owner entry has no workspace authority yet and reads no knowledge, so it answers while the queue still converts
// every restored workspace. Knowledge for anyone without a session stays closed until that conversion ends.
export async function restoredOwnerEntryReady(runtime){
 const entry=await fetch(`${runtime.origin}/api/identity/setup`);
 assert.equal(entry.status,200,'owner entry answers during knowledge conversion');
 await entry.arrayBuffer();
 await conversionReady(`${runtime.origin}/api/knowledge/public`,false);
}

async function conversionReady(url,expectOk=true){
 let response=await fetch(url);
 assert.equal(response.status,503,'restored knowledge stays closed before local conversion');
 const deadline=Date.now()+60000;
 while(response.status===503){
  assert.ok(Number(response.headers.get('Retry-After'))>0,'maintenance supplies a retry interval');
  await response.arrayBuffer();
  assert.ok(Date.now()<deadline,'the packaged queue completes restored knowledge conversion');
  await new Promise(done=>setTimeout(done,100));
  response=await fetch(url);
 }
 if(expectOk)assert.equal(response.status,200,await response.text());
 else await response.arrayBuffer();
}
