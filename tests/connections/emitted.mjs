import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createRuntime} from '../helpers/emitted-runtime.mjs';
import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);

test('an API reply on the emitted Worker reaches the visitor socket and transcript once; API resolve, visitor rating, reopen and stale-rating refusal stay consistent; another workspace token sees nothing',async()=>{
// This is the emitted production Worker and its real Durable Object, not the test Worker.
const runtime=await createRuntime();let socket,success=false;const frames=[];
async function call(path,token,body,origin){const response=await fetch(runtime.origin+path,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(response.ok,path+' status '+response.status);return response.json()}
async function frame(predicate){for(let i=0;i<100;i++){const found=frames.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,100))}throw new Error('Expected native visitor socket frame missing')}
try{

const allowedOrigin='https://widget.example',owner=await runtime.seedTenant({name:'Emitted API',email:'emitted-api@example.test',allowedOrigin});await runtime.presenceAwayOff(owner.projectId);
 const project=await call('/api/identity/projects/'+owner.projectId,owner.token),visitor=await call('/api/identity/widget/session',null,{widgetKey:project.widget_key},allowedOrigin);
 const conversation=await call('/api/conversations',visitor.token,{projectId:owner.projectId});
 await call('/api/conversations/'+conversation.id+'/messages',visitor.token,{localId:'visitor-first',content:'Please help through the native channel',expectedRevision:0});
 const issued=await call('/api/management/projects/'+owner.projectId+'/connections/tokens',owner.token,{name:'Emitted reply proof',scopes:['conversations:read','conversations:write','messages:write']});
 socket=new WebSocket(runtime.origin.replace('http:','ws:')+'/api/conversations/'+conversation.id+'/socket',{headers:{Authorization:'Bearer '+visitor.token,Origin:allowedOrigin}});socket.on('message',data=>frames.push(JSON.parse(String(data))));await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)});
 await frame(value=>value.type==='message'&&value.message.content==='Please help through the native channel');
 const reply=await call('/api/v1/conversations/'+conversation.id+'/messages',issued.token,{localId:'external-native-reply',content:'This API reply reached your native conversation',expectedRevision:1});
 const delivered=await frame(value=>value.type==='message'&&value.message.id===reply.data.id);assert.equal(delivered.message.content,'This API reply reached your native conversation');assert.equal(delivered.message.revision,2);
 const transcript=await call('/api/conversations/'+conversation.id+'/messages',visitor.token);assert.equal(transcript.revision,2);assert.equal(transcript.lastMessageId,reply.data.id);assert.equal(transcript.messages.filter(message=>message.id===reply.data.id).length,1);
 await call('/api/v1/conversations/'+conversation.id+'/resolve',issued.token,{});const closed=await frame(value=>value.type==='resolution'&&value.resolution);assert.equal(closed.resolution.outcome,'unknown');
 await call('/api/conversations/'+conversation.id+'/widget-events',visitor.token,{action:'rateResolution',data:{resolutionId:closed.resolution.id,value:1,comment:'The external answer arrived'}});assert.equal((await call('/api/conversations/'+conversation.id+'/messages',visitor.token)).resolution.rating.comment,'The external answer arrived');
 frames.length=0;
 await call('/api/conversations/'+conversation.id+'/messages',visitor.token,{localId:'visitor-followup',content:'A new followup',expectedRevision:2});await frame(value=>value.type==='resolution'&&value.resolution===null);assert.equal((await call('/api/conversations/'+conversation.id+'/messages',visitor.token)).resolution,null);
 const stale=await fetch(runtime.origin+'/api/conversations/'+conversation.id+'/widget-events',{method:'POST',headers:{Authorization:'Bearer '+visitor.token,'Content-Type':'application/json'},body:JSON.stringify({action:'rateResolution',data:{resolutionId:closed.resolution.id,value:-1,comment:'Stale feedback attempt'}})});assert.equal(stale.status,409);
 // A second cycle proves an API reply publishes the same reopen state.
 await call('/api/v1/conversations/'+conversation.id+'/resolve',issued.token,{});const second=(await call('/api/conversations/'+conversation.id+'/messages',visitor.token)).resolution;assert.ok(second&&second.id!==closed.resolution.id);await frame(value=>value.type==='resolution'&&value.resolution?.id===second.id);frames.length=0;
 const secondReply=await call('/api/v1/conversations/'+conversation.id+'/messages',issued.token,{localId:'external-reopen',content:'Follow-up through the API',expectedRevision:3});assert.equal(secondReply.data.revision,4);await frame(value=>value.type==='message'&&value.message.id===secondReply.data.id);await frame(value=>value.type==='resolution'&&value.resolution===null);assert.equal((await call('/api/conversations/'+conversation.id+'/messages',visitor.token)).resolution,null);
 const foreign=await runtime.seedTenant({name:'Other emitted workspace',email:'foreign-api@example.test'}),foreignToken=await call('/api/management/projects/'+foreign.projectId+'/connections/tokens',foreign.token,{name:'Foreign',scopes:['conversations:read']});assert.equal((await fetch(runtime.origin+'/api/v1/conversations/'+conversation.id,{headers:{Authorization:'Bearer '+foreignToken.token}})).status,404);
 console.log('Emitted Worker: API reply delivered on native visitor socket and transcript; shared resolve, visitor rating, reopen, stale-rating refusal and tenant denial passed.');success=true;
}finally{if(socket){socket.close();await Promise.race([new Promise(r=>socket.readyState===WebSocket.CLOSED?r():socket.once('close',r)),new Promise(r=>setTimeout(r,1000))]);socket.terminate()}await runtime.close(success)}

});
