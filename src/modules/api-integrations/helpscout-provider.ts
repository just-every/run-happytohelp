import {HTTPException} from 'hono/http-exception'

const origin='https://api.helpscout.net'
const id=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):typeof value==='string'&&/^[1-9][0-9]{0,15}$/.test(value)?value:null
export function helpScoutId(value:unknown){const result=id(value);if(!result)throw new HTTPException(400,{message:'A numeric Help Scout ID is required'});return result}
const failure=(code:string):never=>{throw new HTTPException(502,{message:code})}

/** Fixed provider origin, GET only, bounded bytes/deadline, and no redirects.
 * Provider bodies and credential-bearing request objects never enter diagnostics. */
export function helpScoutReader(token:string,beforeRead?:()=>Promise<void>){
 let requests=0,bytes=0
 return async(path:string):Promise<any>=>{
  if(++requests>60)failure('helpscout_request_limit')
  await beforeRead?.()
  const response=await fetch(origin+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)}).catch(()=>failure('helpscout_network_error'))
  if(!response.ok){await response.body?.cancel();failure(response.status===401||response.status===403?'helpscout_permission_denied':response.status===429?'helpscout_rate_limited':'helpscout_http_error')}
  const reader=response.body?.getReader();if(!reader)throw new HTTPException(502,{message:'helpscout_empty_response'})
  const chunks:Uint8Array[]=[];let length=0
  try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;bytes+=part.value.length;if(length>1024*1024||bytes>2*1024*1024){await reader.cancel();failure('helpscout_response_limit')}chunks.push(part.value)}}finally{reader.releaseLock()}
  const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length}
  try{return JSON.parse(new TextDecoder().decode(body))}catch{failure('helpscout_invalid_json')}
 }
}

/** A complete bounded list traversal. Never follow provider-supplied URLs with
 * credentials; pagination receipts must describe the fixed requested resource. */
async function pages(read:ReturnType<typeof helpScoutReader>,path:string,kind:string,max:number){
 const result:any[]=[],seen=new Set<string>();let total:number|undefined
 for(let number=1;number<=10;number++){
  const url=new URL(origin+path);url.searchParams.set('page',String(number))
  const response=await read(url.pathname+url.search),page=response.page,items=response._embedded?.[kind]
  if(!page||page.number!==number||!Number.isSafeInteger(page.totalPages)||page.totalPages<0||page.totalPages>10||!Number.isSafeInteger(page.totalElements)||page.totalElements<0||!Number.isSafeInteger(page.size)||page.size<1||!Array.isArray(items)||items.length>page.size)failure('helpscout_pagination_invalid')
  if(page.totalPages===0){if(number!==1||page.totalElements!==0||items.length||response._links?.next!==undefined)failure('helpscout_pagination_invalid');return []}
  if(total!==undefined&&total!==page.totalElements)failure('helpscout_pagination_changed');total=page.totalElements
  if(page.totalElements>max)failure('helpscout_record_limit')
  let self:URL;try{self=new URL(response._links?.self?.href)}catch{failure('helpscout_page_scope_invalid')}
  self!.searchParams.set('page',self!.searchParams.get('page')??'1')
  const same=(value:URL,expected:URL)=>value.origin===expected.origin&&value.pathname===expected.pathname&&!value.username&&!value.password&&!value.hash&&[...value.searchParams].sort().toString()===[...expected.searchParams].sort().toString()
  if(!same(self!,url))failure('helpscout_page_scope_invalid')
  for(const item of items){const key=id(item.id);if(!key||seen.has(key))throw new HTTPException(502,{message:'helpscout_duplicate_source_id'});seen.add(key);if(seen.size>max)failure('helpscout_record_limit')}
  result.push(response)
  if(number===page.totalPages){if(response._links?.next!==undefined||seen.size!==total)failure('helpscout_pagination_incomplete');return result}
  let next:URL;try{next=new URL(response._links?.next?.href)}catch{failure('helpscout_pagination_incomplete')}
  url.searchParams.set('page',String(number+1));if(!same(next!,url))failure('helpscout_next_scope_invalid')
 }
 return failure('helpscout_page_limit')
}

export async function helpScoutSnapshot(read:ReturnType<typeof helpScoutReader>,mailbox:string,cursor:string){
 // An overlap makes equal timestamps and changes during traversal eligible again.
 // Content receipts, rather than the clock, deduplicate their eventual staging.
 const since=new Date(Math.max(0,Date.parse(cursor)-5*60000)).toISOString().replace('.000Z','Z')
 const query=new URLSearchParams({mailbox,status:'all',modifiedSince:since,sortField:'modifiedAt',sortOrder:'asc'})
 const list=await pages(read,'/v2/conversations?'+query,'conversations',20),snapshots:{id:string;responses:any[]}[]=[]
 const customers=new Map<string,any>()
 for(const page of list)for(const item of page._embedded.conversations){
  const source=helpScoutId(item.id),conversation=await read('/v2/conversations/'+source)
  if(String(conversation.id)!==source||String(conversation.mailboxId)!==mailbox)failure('helpscout_conversation_scope_invalid')
  const customerId=helpScoutId(conversation.primaryCustomer?.id)
  if(!customers.has(customerId)){const customer=await read('/v2/customers/'+customerId);if(String(customer.id)!==customerId)failure('helpscout_customer_scope_invalid');customers.set(customerId,customer)}
  const threads=await pages(read,'/v2/conversations/'+source+'/threads','threads',200)
  snapshots.push({id:source,responses:[customers.get(customerId),conversation,...threads]})
 }
 return snapshots
}
