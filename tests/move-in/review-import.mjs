import assert from 'node:assert/strict'
import {nativeHarness} from './harness.mjs'
import {generate} from './generator.mjs'
import {responses} from './helpscout-fixtures.mjs'
import {cannedResponse} from './freshdesk-fixtures.mjs'
import {suppliedFreshdesk,publicBytes,privateBytes} from './supplied-attachments.mjs'
import {assertBusinessEquality} from './business-equality.mjs'
import {zip} from './zip.mjs'
import {configurationSource,fieldValues,withCompany} from './configuration-source.mjs'
import {configurationReview} from './configuration-review.mjs'
import {root,json,encode,review,apply,undo,rows} from './journey-kit.mjs'

// Each document follows the same migration, from a bad upload to reviewed native
// history, inert repetition and whole-import undo. This is a format data table.
export async function reviewImportJourney(){
 const sources=[
  {vendor:'zendesk',body:generate('zendesk',6),conversations:6,messages:12,notes:6,articles:2,macros:1,reply:'Historical reply 1',private:'Private note 1'},
  {vendor:'intercom',body:generate('intercom',2),conversations:2,messages:4,notes:2,articles:2,macros:1,reply:'Historical reply 1',private:'Private note 1'},
  {vendor:'helpscout',body:encode(responses()),conversations:1,messages:2,notes:1,articles:2,macros:0,reply:'Historical reply',private:'Private note'},
  {vendor:'freshdesk',body:encode([...suppliedFreshdesk(),cannedResponse]),conversations:1,messages:3,notes:1,articles:0,macros:1,reply:'Refund sent.',private:'Private triage'},
 ]
 for(const source of sources){
  const records=source.body.trim().split('\n').map(JSON.parse)
  withCompany(source.vendor,records)
  if(source.vendor==='zendesk'){
   const states=['new','open','pending','hold','solved','closed']
   records.filter(row=>row.ticket).forEach((row,index)=>{row.ticket.status=states[index];row.ticket.via={channel:index%2?'email':'web'}})
   records.find(row=>row.ticket).ticket.custom_fields=fieldValues
   records.push(...configurationSource())
  }
  source.body=encode(records)
  const h=await nativeHarness()
  try{
   const initial=await h.snapshot(),bad=await h.raw(`${root}?vendor=${source.vendor}`,{method:'POST',headers:{'X-Import-Filename':'broken.jsonl','X-Import-Schema':'2.16'},body:source.body+'\n{malformed'})
   assert.equal(bad.response.status,422)
   assert.equal(bad.data.diagnostic.code,'invalid_json')
   assert.equal(bad.data.diagnostic.location.artifact,'broken.jsonl')
   assert.equal(bad.data.diagnostic.location.row,source.body.trimEnd().split('\n').length+2-(source.body.endsWith('\n')?0:1))
   assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0)
   assert.equal((await (await h.files).list()).objects.length,0)
   assertBusinessEquality(initial,await h.snapshot())
   const ready=await review(h,source.vendor,source.body)
   assert.equal(ready.plan.counts.rejected,source.vendor==='zendesk'?2:0,JSON.stringify(ready.plan))
   assert.ok(ready.plan.decisions.every(item=>item.sourceId&&item.location.artifact==='history.jsonl'&&item.location.row>0))
   assert.ok(ready.plan.decisions.some(item=>item.targets.some(target=>target.kind==='conversation')))
   assertBusinessEquality(initial,await h.snapshot())
   assert.equal((await h.raw(`${root}/${ready.id}/apply`,json({fingerprint:'unreviewed-plan'}))).response.status,409)
   assertBusinessEquality(initial,await h.snapshot())
   const custody=(await rows(h,'SELECT object_key FROM move_in_runs WHERE id=?',ready.id))[0]
   assert.deepEqual(Buffer.from(await (await (await h.files).get(custody.object_key)).arrayBuffer()),Buffer.from(source.body))
   await apply(h,ready)
   for(const [table,count] of [['conversations',source.conversations],['messages',source.messages],['move_in_notes',source.notes],['knowledge_articles',source.articles],['macros',source.macros]])assert.equal((await rows(h,`SELECT COUNT(*) n FROM ${table}`))[0].n,count,source.vendor+' '+table)
   const thread=(await rows(h,'SELECT c.id,c.contact_id FROM conversations c JOIN move_in_conversations m ON m.conversation_id=c.id ORDER BY m.source_id'))[0]
   const detail=(await h.call(`/api/dashboard/projects/p/conversations/${thread.id}`)).data
   assert.equal(detail.imported.vendor,source.vendor);assert.ok(detail.tags.length>0)
   const buckets=(await h.call(`/api/dashboard/projects/p/conversations/${thread.id}/buckets`)).data
   const answer=buckets.flatMap(bucket=>bucket.messages).find(message=>message.content===source.reply)
   assert.ok(answer,'the imported historical answer reaches the operator transcript')
   const answerAt=source.vendor==='freshdesk'?Date.UTC(2024,0,2,9,10):1704067380000
   assert.equal(Date.parse(answer.created_at),answerAt,'the original answer time survives import')
   assert.ok(buckets.flatMap(bucket=>bucket.events).some(event=>event.type==='INTERNAL_NOTE'&&event.content===source.private),'the original private note reaches only the operator timeline')
   const transcript=await h.call(`/api/conversations/${thread.id}/messages`)
   assert.ok(!JSON.stringify(transcript).includes(source.private),'the customer transcript never includes the private note')
   const times=await rows(h,'SELECT created_at FROM messages ORDER BY created_at')
   assert.ok(times.every(item=>item.created_at<Date.parse('2025-01-01')),'original message times survive import')
   assert.ok((await rows(h,'SELECT assigned_to FROM conversations')).every(item=>item.assigned_to===null),'historical staff receive no live assignment')
   assert.equal((await rows(h,'SELECT COUNT(*) n FROM users'))[0].n,3,'historical authors acquire no access')
   const companies=(await h.call('/api/management/projects/p/companies')).companies
   assert.equal(companies.length,1);assert.equal(companies[0].portalCompanyView,false);assert.equal(companies[0].memberCount,1)
   assert.deepEqual(companies[0].domains,source.vendor==='intercom'?[]:['northstar.example'])
   const company=await h.call('/api/management/projects/p/companies/'+companies[0].id)
   assert.equal(company.members.length,1)
   if(source.vendor==='zendesk'){
    await configurationReview(h,ready.plan)
    const landed=await rows(h,'SELECT m.source_id,c.status_category,c.channel FROM move_in_conversations m JOIN conversations c ON c.id=m.conversation_id ORDER BY m.source_id')
    assert.deepEqual(landed.map(row=>[row.status_category,row.channel]),[['new','widget'],['open','email'],['pending','widget'],['on_hold','email'],['solved','widget'],['closed','email']])
   }
   const published=await h.call('/api/knowledge/public/p/articles')
   assert.equal(published.length,source.articles?1:0)
   assert.ok(!published.some(item=>item.title==='Draft guide'))
   for(const file of await rows(h,'SELECT * FROM media')){
    const path=`/api/conversations/${file.conversation_id}/media/${file.id}`
    assert.deepEqual((await h.download(path)).bytes,file.message_id?publicBytes:privateBytes)
    assert.equal((await h.download(path,'foreign')).status,404)
   }
   assert.equal((await h.call('/api/dashboard/projects/p/reports?period=7')).volume,0,'historical imports never enter analytics')
   const landed=await h.snapshot()
   const repeat=await h.call(`${root}?vendor=${source.vendor}`,{method:'POST',headers:{'X-Import-Filename':'history.jsonl','X-Import-Schema':'2.16'},body:source.body})
   assert.equal(repeat.alreadyImported,true);assert.equal(repeat.writes,0);assert.equal(h.lastWrites,0)
   assertBusinessEquality(landed,await h.snapshot())
   const repacked=await review(h,source.vendor,zip([{name:'nested/source.jsonl',body:source.body}]),'repacked.zip')
   await apply(h,repacked)
   assertBusinessEquality(landed,await h.snapshot())
   assert.deepEqual(Buffer.from(await (await (await h.files).get(custody.object_key)).arrayBuffer()),Buffer.from(source.body),'later reviews retain immutable source custody')
   await undo(h,repacked);await undo(h,ready)
   assertBusinessEquality(initial,await h.snapshot())
   assert.equal(h.outbound,0,'review, publication, repeat and undo make no provider requests')
  }finally{await h.close()}
 }
}
