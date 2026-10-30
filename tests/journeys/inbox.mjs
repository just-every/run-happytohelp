import test from 'node:test'
import assert from 'node:assert/strict'
import {startApp} from './kit/app.mjs'
import {ticketsJourney} from '../helpers/inbox/tickets.mjs'
import {statusLifecycleJourney} from '../helpers/inbox/status-lifecycle.mjs'
import {brandsJourney} from '../helpers/inbox/brands.mjs'

test('a replacement request moves through scoped fields, a reviewed macro, shared queue work, private collaboration, routing, schedules and durable automations before closure and erasure',async()=>{
 const app=await startApp()
 try{
  const workspace=await app.seedWorkspace('synthetic-happytohelp-1')
  const unknown=await app.request('/api/management/bootstrap?projectId=synthetic-missing',{token:workspace.tokens.operator})
  assert.equal(unknown.status,403)
  const refusal=await unknown.text(),results=[]
  for(const name of ['constructor','toString','valueOf','__proto__','hasOwnProperty'])for(const inbox of ['', '&inbox=project','&inbox=global']){
   const response=await app.request('/api/management/bootstrap?projectId='+encodeURIComponent(name)+inbox,{token:workspace.tokens.operator})
   results.push({name,inbox,status:response.status,body:await response.text()})
  }
  const open=await app.request('/api/dashboard/conversations?view=open',{token:workspace.tokens.operator})
  assert.equal(open.status,200)
  const openData=await open.json()
  for(const name of ['constructor','toString','valueOf','__proto__','hasOwnProperty'])for(const parameter of ['view','filter']){
   const response=await app.request('/api/dashboard/conversations?'+parameter+'='+encodeURIComponent(name),{token:workspace.tokens.operator})
   assert.equal(response.status,200,name+': '+await response.clone().text())
   assert.deepEqual(await response.json(),openData,name+' uses the default inbox')
  }
  for(const name of ['constructor','toString','valueOf','__proto__','hasOwnProperty'])for(const resource of ['contacts','macros']){
   const response=await app.request('/api/management/projects/'+workspace.projectId+'/'+resource+'?sort='+encodeURIComponent(name),{token:workspace.tokens.operator})
   assert.equal(response.status,400,resource+': '+await response.clone().text())
   assert.doesNotMatch(await response.text(),/binding|stack|native code/i)
  }
  for(const {name,inbox,status,body} of results){
   assert.equal(status,403,name+inbox+': '+body)
   assert.equal(body,refusal,name+inbox)
   assert.doesNotMatch(body,/binding|stack|native code/i)
  }
 }finally{await app.close()}
 await ticketsJourney()
 await statusLifecycleJourney()
})
test('two brands share a permitted team while customer identity, knowledge, routing, sender policy and reports retain their current brand authority',brandsJourney)

import {problemJourney} from '../helpers/inbox/problems.mjs'
test('a support lead links affected requests to one problem, follows its engineering issue and sends scoped recovery updates once while preferences, provider uncertainty and erasure remain honest',problemJourney)
