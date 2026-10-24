import assert from 'node:assert/strict'
import {createServer} from 'node:net'
import {createHash} from 'node:crypto'
import {createConfiguredMailRuntime,mailReceipts} from '../configured-mail-runtime.mjs'
import {evidence} from '../../journeys/kit/browser.mjs'
import {installedWidget} from './installed.mjs'

const freePort=async()=>{const socket=createServer();await new Promise(done=>socket.listen(0,'127.0.0.1',done));const port=socket.address().port;await new Promise(done=>socket.close(done));return port}

// The deployed Worker-first widget: a cached, origin-specific /widget.js, the legacy project lookup for allowed
// origins only, and the installed widget on a separate site origin (see installed.mjs).
export async function installedJourney(){
 const apiPort=await freePort(),runtime=await createConfiguredMailRuntime({port:apiPort,workerFirst:true,vars:{APP_ORIGIN:`http://127.0.0.1:${apiPort}`}});let success=false
 const call=async(path,body,token,extra={})=>{const response=await fetch(runtime.origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(response.ok,`${path}: ${response.status} ${await response.clone().text()}`);return response.json()}
 try{
  const asset=await fetch(runtime.origin+'/widget.js'),bytes=Buffer.from(await asset.arrayBuffer()),etag='"'+createHash('sha256').update(bytes).digest('hex')+'"'
  const repeated=await fetch(runtime.origin+'/widget.js',{headers:{'If-None-Match':etag}})
  const otherOrigin=await fetch(runtime.origin+'/widget.js',{headers:{'If-None-Match':'"'+createHash('sha256').update(bytes.toString().replace(runtime.origin,'https://other-installation.example')).digest('hex')+'"'}})
  assert.equal(asset.status,200);assert.ok(bytes.toString().startsWith('if(document.currentScript'));assert.ok(bytes.toString().slice(0,250).includes(JSON.stringify(runtime.origin)),'the script names this installation')
  assert.equal(asset.headers.get('ETag'),etag);assert.match(asset.headers.get('Cache-Control'),/public.*max-age=[1-9][0-9]*.*stale-while-revalidate=/)
  assert.equal(repeated.status,304);assert.equal((await repeated.arrayBuffer()).byteLength,0);assert.equal(repeated.headers.get('Cache-Control'),asset.headers.get('Cache-Control'))
  assert.equal(otherOrigin.status,200,'another installation\'s tag is not this script');assert.deepEqual(Buffer.from(await otherOrigin.arrayBuffer()),bytes)
  const origin=`http://127.0.0.1:${await freePort()}`
  const owner=await call('/api/identity/bootstrap',{password:'synthetic-test-setup-password-123',name:'Widget runtime proof',email:'widget-runtime@example.test',allowedOrigin:origin})
  const project=await call(`/api/identity/projects/${owner.projectId}`,undefined,owner.token)
  await call(`/api/forms/projects/${owner.projectId}/forms`,{title:'Order question',locale:'en',enabled:true,fields:[]},owner.token)
  assert.equal((await call(`/api/widget/legacy-project?projectId=${encodeURIComponent(owner.projectId)}`,undefined,undefined,{Origin:origin})).widgetKey,project.widget_key)
  assert.equal((await fetch(`${runtime.origin}/api/widget/legacy-project?projectId=${owner.projectId}`,{headers:{Origin:'https://untrusted.example'}})).status,403)
  assert.equal((await fetch(`${runtime.origin}/api/widget/legacy-project?projectId=unknown`,{headers:{Origin:origin}})).status,403)
  const foreignOwner=await runtime.seedTenant({name:'Other tenant',email:'foreign-widget@example.test',allowedOrigin:origin})
  const foreignProject=await call(`/api/identity/projects/${foreignOwner.projectId}`,undefined,foreignOwner.token),foreignContact=await call('/api/identity/widget/session',{widgetKey:foreignProject.widget_key},undefined,{Origin:origin})
  const foreignConversation=await call('/api/conversations',{projectId:foreignOwner.projectId},foreignContact.token)
  await installedWidget({mailReceipts:()=>mailReceipts(runtime),api:runtime.origin,origin,widgetKey:project.widget_key,ownerToken:owner.token,projectId:owner.projectId,foreignConversation:foreignConversation.id,evidence:(await evidence('widget'))('')})
  success=true
 }finally{await runtime.close(success)}
}
