import {HTTPException} from 'hono/http-exception'
/** Browser writes require an explicit same-origin proof, including HTML forms. */
export function portalSameOrigin(request:Request){
 const origin=request.headers.get('Origin'),referer=request.headers.get('Referer'),expected=new URL(request.url).origin
 if(origin===expected)return
 if(!origin&&referer){try{if(new URL(referer).origin===expected)return}catch{}}
 throw new HTTPException(403,{message:'Same-origin request required'})
}
export function portalReturnPath(value:unknown,projectId:string,aliases:string[]=[]){
 const fallback=`/portal/${encodeURIComponent(projectId)}/requests`
 if(typeof value!=='string'||value.length>1000||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020#]/.test(value))return fallback
 try{
  const url=new URL(value,'https://portal.invalid')
  if(url.origin!=='https://portal.invalid')return fallback
  for(const key of [projectId,...aliases]){
   const portal=`/portal/${encodeURIComponent(key)}`,help=`/help/${encodeURIComponent(key)}/requests`
   if([portal,portal+'/requests',portal+'/requests/new',portal+'/preferences',help].includes(url.pathname))return url.pathname+url.search
   for(const prefix of [portal+'/requests/',help+'/'])if(url.pathname.startsWith(prefix)&&/^[a-zA-Z0-9_-]{1,100}$/.test(url.pathname.slice(prefix.length)))return url.pathname+url.search
  }
  return fallback
 }catch{return fallback}
}
export async function portalBody(c:any){return c.req.header('Content-Type')?.includes('application/json')?c.req.json():c.req.parseBody()}
export const isPortalForm=(c:any)=>!c.req.header('Content-Type')?.includes('application/json')
