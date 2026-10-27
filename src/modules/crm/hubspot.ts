/** Fixed provider origin, bounded bodies, no redirects and no automatic retries. */
export class HubSpotError extends Error {
 constructor(public state='unavailable'){super('HubSpot context is '+state)}
}
export async function request(token:string,path:string,introspect=false):Promise<any>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000)
 try{
  const response=await fetch('https://api.hubapi.com'+path,{
   method:introspect?'POST':'GET',redirect:'manual',signal:controller.signal,
   headers:introspect?{'Content-Type':'application/json'}:{Authorization:'Bearer '+token,Accept:'application/json'},
   ...(introspect?{body:JSON.stringify({tokenKey:token})}:{})
  })
  if(!response.ok){await response.body?.cancel();throw new HubSpotError([401,403].includes(response.status)?'permission_lost':'unavailable')}
  const reader=response.body?.getReader();if(!reader)throw new HubSpotError()
  const chunks:Uint8Array[]= [];let size=0
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536){await reader.cancel();throw new HubSpotError()};chunks.push(part.value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
 }catch(error){throw error instanceof HubSpotError?error:new HubSpotError()}
 finally{clearTimeout(timer)}
}
export const scopes=['crm.objects.contacts.read','crm.objects.companies.read']
export async function account(token:string){
 const info=await request(token,'/oauth/v2/private-apps/get/access-token-info',true)
 if(!Array.isArray(info.scopes)||scopes.some(scope=>!info.scopes.includes(scope))||info.scopes.some((scope:unknown)=>!scopes.includes(String(scope))))throw new HubSpotError('scope_refused')
 if(!/^\d+$/.test(String(info.hubId)))throw new HubSpotError()
 return String(info.hubId)
}
export async function record(token:string,kind:'contacts'|'companies',id:string,properties:string[]){
 const result=await request(token,`/crm/v3/objects/${kind}/${encodeURIComponent(id)}?properties=${properties.map(encodeURIComponent).join(',')}${kind==='contacts'?'&associations=companies':''}`)
 if(result.id!==id||result.archived||!result.properties||typeof result.properties!=='object')throw new HubSpotError('identity_mismatch')
 const values:Record<string,string|null>={}
 for(const name of properties){const value=result.properties[name];if(value!=null&&typeof value!=='string')throw new HubSpotError();values[name]=value??null}
 return {id,updatedAt:typeof result.updatedAt==='string'?result.updatedAt:null,properties:values,companies:result.associations?.companies?.results?.map((v:any)=>v.id)??[]}
}
