import {baseUrl} from '../escalations/providers/http'
import {teamsTarget} from '../escalations/providers/teams'
import type {Connection} from '../escalations/providers'

type Outcome={state:'accepted'|'failed'|'uncertain'|'rate_limited';retryAfterMs?:number}
/** The Graph boundary has no redirects or retries. Only an explicit 429 refusal
 * can authorize another attempt; incomplete or ambiguous responses never do. */
export async function sendTeamsAlert(connection:Connection,body:string,now:number):Promise<Outcome>{
 const [team,channel]=teamsTarget(connection.target),origin=baseUrl(connection)
 if(!connection.token||/[\r\n]/.test(connection.token))throw new Error('Invalid Teams configuration')
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000)
 try{
  const response=await fetch(`${origin}/v1.0/teams/${encodeURIComponent(team)}/channels/${encodeURIComponent(channel)}/messages`,{
   method:'POST',headers:{Authorization:/^Bearer /i.test(connection.token)?connection.token:`Bearer ${connection.token}`,'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({body:{contentType:'text',content:body}}),redirect:'manual',signal:controller.signal
  })
  if(response.status!==201){
   await response.body?.cancel()
   if(response.status===429){
    const raw=response.headers.get('Retry-After'),delay=raw&&/^\d+$/.test(raw)?Number(raw)*1000:raw?Date.parse(raw)-now:NaN
    return Number.isSafeInteger(delay)&&delay>=0?{state:'rate_limited',retryAfterMs:delay}:{state:'failed'}
   }
   return {state:[400,401,403,404,405,410,413,415,422].includes(response.status)?'failed':'uncertain'}
  }
  const reader=response.body?.getReader()
  if(!reader)return {state:'uncertain'}
  const chunks:Uint8Array[]=[];let size=0
  for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>65536){await reader.cancel();return {state:'uncertain'}}chunks.push(chunk.value)}
  const bytes=new Uint8Array(size);let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
  return typeof data?.id==='string'&&/^\d+$/.test(data.id)?{state:'accepted'}:{state:'uncertain'}
 }catch{return {state:'uncertain'}}finally{clearTimeout(timeout)}
}
