import type {Env} from '../../platform/env'

type Row=Record<string,unknown>&{id:string;conversationId:string}
/** Global keyset pages keep both long transcripts and large workspaces bounded. */
export async function* transcriptRecords(env:Env,sql:string,args:unknown[],order:'id'|'revision'='id'){
 let conversationId='',position:unknown=order==='revision'?0:''
 for(;;){
  const {results}=await env.DB.prepare(`SELECT * FROM (${sql}) WHERE conversationId>? OR (conversationId=? AND ${order}>?) ORDER BY conversationId,${order} LIMIT 100`).bind(...args,conversationId,conversationId,position).all<Row>()
  for(const row of results)yield row
  if(results.length<100)return
  const last=results[results.length-1];conversationId=last.conversationId;position=last[order]
 }
}

/** Share one cursor across conversations, without a query for each empty collection. */
export function transcriptGroups(rows:AsyncGenerator<Row>){
 let pending:IteratorResult<Row>|undefined
 return {
  async *take(conversationId:string){
   pending??=await rows.next()
   while(!pending.done&&pending.value.conversationId<conversationId)pending=await rows.next()
   while(!pending.done&&pending.value.conversationId===conversationId){
    const {conversationId:_,...row}=pending.value
    yield row
    pending=await rows.next()
   }
  },
  async close(){await rows.return(undefined)}
 }
}
