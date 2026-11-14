import assert from 'node:assert/strict';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]),packet=resolve(process.argv[3]);
const {createRuntime}=await import(pathToFileURL(join(root,'tests/helpers/emitted-runtime.mjs')));
const version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const upstream=JSON.parse(await readFile(join(root,'rer-upstream.json'),'utf8'));
const runtime=await createRuntime({});let success=false,hidden=false;
try {
 const response=await fetch(runtime.origin+'/health');assert.equal(response.status,200);
 const health=await response.json();
 assert.deepEqual(health.release,{version,sourceCommit:upstream.commit});
 assert.equal(upstream.tag,'v'+health.release.version);
 assert.deepEqual(health.deployment,{sourceSha:null,fingerprint:null,versionId:null});
 assert.equal(health.ok,true);
 // Neither Git nor the upstream record exists while the second request runs.
 // Only the build should need either source.
 await rename(join(root,'.git'),join(root,'.git.saved'));
 try {await rename(join(root,'rer-upstream.json'),join(root,'rer-upstream.json.saved'));hidden=true;}
 catch(error){await rename(join(root,'.git.saved'),join(root,'.git'));throw error;}
 const again=await fetch(runtime.origin+'/health');assert.equal(again.status,200);
 assert.deepEqual(await again.json(),health);
 await writeFile(join(packet,'managed-health.json'),JSON.stringify({status:response.status,health,upstream,runtimeSourceFilesAbsent:true,assertions:'release matches upstream tag/commit; default deployment unchanged; same built response without Git or provenance file'},null,2)+'\n');
 success=true;
} finally {
 if(hidden){await rename(join(root,'.git.saved'),join(root,'.git'));await rename(join(root,'rer-upstream.json.saved'),join(root,'rer-upstream.json'));}
 await runtime.close(success);
}
