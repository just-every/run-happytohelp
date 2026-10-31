import type {Env} from '../../platform/env'
import {issuerGuard,type Issuer} from '../../platform/integration-authority'
import {moveInRoutes} from '../move-in/routes'
import {decryptToken} from '../integrations/secrets'
import {scoutClient,ScoutError} from './helpscout-client'

/** Review authority is the caller's native session, never a provider credential. */
export async function pullScout(env:Env,who:Issuer,headers:Headers,execution:Parameters<typeof moveInRoutes.fetch>[2]){
 const project=who.actor.projectId,guard=await issuerGuard(env,who),row=await env.DB.prepare('SELECT * FROM helpscout_connections WHERE project_id=? AND secret_ciphertext IS NOT NULL').bind(project).first<any>()
 if(!row)throw new ScoutError('disconnected')
 const claim=crypto.randomUUID(),start=row.scan_started_at??new Date().toISOString(),waiting=row.waiting_events
 const locked=await env.DB.prepare(`UPDATE helpscout_connections SET claim=?,claim_until=? WHERE project_id=? AND revision=? AND (claim IS NULL OR claim_until<?) AND EXISTS(${guard.sql})`).bind(claim,Date.now()+60000,project,row.revision,Date.now(),...guard.params).run()
 if(!locked.meta.changes)throw new ScoutError('pull_in_progress')
 let lastRun:string|null=null,skipped=0,runs:string[]=[],nextPage:string|null=null
 try{
  const client=scoutClient(JSON.parse(await decryptToken(env,project,row.secret_ciphertext))),token=await client.access()
  const query=new URLSearchParams({mailbox:row.mailbox_id,status:'all',sortField:'modifiedAt',sortOrder:'asc',...(row.cursor?{modifiedSince:row.cursor}:{})})
  let path=row.next_page??'/v2/conversations?'+query,seen=new Set<string>(),conversations=0
  while(path){
   if(seen.has(path))throw new ScoutError('pagination_invalid');seen.add(path)
   const list=await client.get(path,token),items=list.data._embedded?.conversations
   const page=list.data.page,requested=new URL(path,'https://api.helpscout.net')
   if(!Array.isArray(items)||!page||!Number.isSafeInteger(page.number)||page.number!==Number(requested.searchParams.get('page')??1)||!Number.isSafeInteger(page.totalPages)||page.totalPages<1||page.number>page.totalPages||!Number.isSafeInteger(page.totalElements)||page.totalElements<items.length)throw new ScoutError('response_invalid')
   const following=next(list.data,'/v2/conversations')
   if((page.number<page.totalPages)!==!!following)throw new ScoutError('pagination_invalid')
   if(following){const url=new URL(following),original=new URL(requested);if(url.searchParams.get('page')!==String(page.number+1))throw new ScoutError('pagination_invalid');url.searchParams.delete('page');original.searchParams.delete('page');url.searchParams.sort();original.searchParams.sort();if(url.search!==original.search)throw new ScoutError('pagination_invalid')}
   for(const item of items){
    if(++conversations>25||!Number.isSafeInteger(item.id)||item.id<1)throw new ScoutError('pull_limit')
    const detail=await client.get('/v2/conversations/'+item.id,token),customerId=detail.data.primaryCustomer?.id
    if(!Number.isSafeInteger(customerId)||customerId<1||detail.data.id!==item.id||String(detail.data.mailboxId)!==row.mailbox_id)throw new ScoutError('response_invalid')
    const customer=await client.get('/v2/customers/'+customerId,token),parts=[customer.raw,detail.raw],threadSeen=new Set<string>()
    let threadPath='/v2/conversations/'+item.id+'/threads'
    while(threadPath){if(threadSeen.has(threadPath))throw new ScoutError('pagination_invalid');threadSeen.add(threadPath);const threads=await client.get(threadPath,token);parts.push(threads.raw);threadPath=next(threads.data,'/v2/conversations/'+item.id+'/threads')}
    // Recheck both connection generation and reviewer before entering immutable import custody.
    if(!await env.DB.prepare(`SELECT 1 FROM helpscout_connections WHERE project_id=? AND revision=? AND claim=? AND secret_ciphertext IS NOT NULL AND EXISTS(${guard.sql})`).bind(project,row.revision,claim,...guard.params).first())throw new ScoutError('authority_changed')
    const result=await moveInRoutes.fetch(new Request('https://import.internal/projects/'+encodeURIComponent(project)+'/imports?vendor=helpscout',{method:'POST',headers:{Authorization:headers.get('Authorization')??'',Cookie:headers.get('Cookie')??'','Content-Type':'application/json','X-Import-Filename':'helpscout-sync.json'},body:'['+parts.join(',')+']'}),env,execution)
    // An unchanged erased artifact is refused by Hono as plain text, before
    // the import door's JSON identity check. Skip it without retaining content.
    if(result.status===410&&result.headers.get('Content-Type')?.startsWith('text/plain')){
     if(await result.text()==='This export contains erased data and cannot be replayed'){skipped++;continue}
     throw new ScoutError('import_refused')
    }
    const receipt:any=await result.json()
    if(result.status===410&&(receipt.code==='erased_identity_match'||String(receipt.error).includes('erased data'))){skipped++;continue}
    if(!result.ok||!receipt.data?.id)throw new ScoutError(result.status===401||result.status===403?'reviewer_refused':'import_refused')
    lastRun=receipt.data.id;runs.push(lastRun!)
   }
   nextPage=following||null;break
  }
  const saved=await env.DB.prepare(`UPDATE helpscout_connections SET cursor=?,next_page=?,scan_started_at=?,last_pull_at=?,last_run_id=coalesce(?,last_run_id),skipped_erased=?,waiting_events=max(0,waiting_events-?),error_class=NULL,claim=NULL,claim_until=NULL WHERE project_id=? AND revision=? AND claim=? AND secret_ciphertext IS NOT NULL AND EXISTS(${guard.sql})`).bind(nextPage?row.cursor:start,nextPage,nextPage?start:null,Date.now(),lastRun,skipped,waiting,project,row.revision,claim,...guard.params).run()
  if(!saved.meta.changes)throw new ScoutError('authority_changed')
  return {runs,skips:Array.from({length:skipped},()=>({reason:'erased_identity_match'})),skipped_erased:skipped,cursor:nextPage?row.cursor:start,has_more:!!nextPage,review_required:true}
 }catch(error){const code=error instanceof ScoutError?error.code:'pull_failed';await env.DB.prepare('UPDATE helpscout_connections SET error_class=?,claim=NULL,claim_until=NULL WHERE project_id=? AND revision=? AND claim=?').bind(code,project,row.revision,claim).run();throw new ScoutError(code)}
}
function next(data:any,path:string):string{
 const link=data._links?.next?.href
 if(link===undefined)return ''
 try{const url=new URL(link);if(url.origin!=='https://api.helpscout.net'||url.pathname!==path||url.username||url.password)throw Error();return url.href}catch{throw new ScoutError('pagination_invalid')}
}
