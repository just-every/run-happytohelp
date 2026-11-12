import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const numericOrder=(a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0
const stableTuples=rows=>rows.map(row=>JSON.stringify(row)).sort()
// Full local observations, separate from independent incumbent census files. Never
// deduplicate rows before counting them, nor substitute a pull's progress totals.
export async function nativeSnapshot(h,project='p',limit=2){
 const root=`/api/move-in/projects/${project}/zendesk/diagnostics`,startedAt=Date.now()
 const before=(await h.call(`${root}/summary`)).data,pages={tickets:[],articles:[]},cursors={tickets:[],articles:[]}
 for(const kind of ['tickets','articles']){
  let cursor=null;const seen=new Set()
  do{
   const result=await h.raw(`${root}/${kind}?${new URLSearchParams({limit:String(limit),...(cursor?{cursor}:{})})}`)
   assert.equal(result.response.status,200);assert.equal(result.response.headers.get('Cache-Control'),'no-store')
   const page=result.data.data;assert.ok(page.rows.length<=limit)
   pages[kind].push(page.rows);cursors[kind].push(cursor)
   cursor=page.nextCursor
   if(cursor){assert.ok(!seen.has(cursor),'keyset advances');seen.add(cursor)}
  }while(cursor)
 }
 const summary=(await h.call(`${root}/summary`)).data
 const tickets=pages.tickets.flat(),articles=pages.articles.flat(),sourceIds=[...new Set(tickets.map(row=>row.sourceId))].sort(numericOrder)
 const complete=JSON.stringify(before)===JSON.stringify(summary)&&tickets.length===summary.mappingRows&&articles.length===summary.articleOrigins
 return {schemaVersion:1,project,startedAt,completedAt:Date.now(),before,summary,pages,cursors,tickets,articles,sourceIds,sourceIdHash:createHash('sha256').update(sourceIds.join(',')).digest('hex'),tupleFingerprint:digest({tickets:stableTuples(tickets),articles:stableTuples(articles)}),complete}
}
export function assertRepeatSurvival(before,after){
 assert.ok(before.complete&&after.complete,'unstable or incomplete native observation cannot pass')
 assert.equal(after.tickets.length,after.sourceIds.length,'one native mapping per ticket after repeat')
 assert.equal(before.tickets.length,before.sourceIds.length,'pre-repeat mappings are unique')
 const retained=new Set(after.sourceIds)
 assert.ok(before.sourceIds.every(id=>retained.has(id)),'every pre-repeat source ID survives')
 // Targets/counts can legitimately change, and new sources can arrive. The tuple
 // fingerprint diagnoses changes; equality is not an acceptance requirement.
}
