/** The unchanged js-host snippet must reach the installation's canonical API. */
function widgetPrefix(request:Request,apiOrigin:unknown):string|null {
 if(new URL(request.url).pathname!=='/widget.js' || !['GET','HEAD'].includes(request.method) || typeof apiOrigin!=='string')return null
 let origin:URL
 try {origin=new URL(apiOrigin)} catch {return null}
 if(origin.origin!==apiOrigin || origin.protocol!=='https:' && !(origin.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(origin.hostname)))return null
 return `if(document.currentScript&&!document.currentScript.dataset.apiOrigin)document.currentScript.dataset.apiOrigin=${JSON.stringify(origin.origin)};\n`
}

/** Validate the final script, never the unprefixed asset's validator or byte range. */
export function widgetAssetRequest(request:Request,apiOrigin:unknown):Request {
 if(widgetPrefix(request,apiOrigin)===null)return request
 const headers=new Headers(request.headers)
 for(const name of ['If-None-Match','If-Modified-Since','Range','If-Range'])headers.delete(name)
 return new Request(request,{method:'GET',headers})
}

export async function widgetAssetOrigin(request:Request,response:Response,apiOrigin:unknown):Promise<Response> {
 const prefix=widgetPrefix(request,apiOrigin)
 if(prefix===null || response.status!==200)return response
 const script=await response.arrayBuffer(),prefixBytes=new TextEncoder().encode(prefix)
 const bytes=new Uint8Array(prefixBytes.length+script.byteLength)
 bytes.set(prefixBytes);bytes.set(new Uint8Array(script),prefixBytes.length)
 const digest=await crypto.subtle.digest('SHA-256',bytes)
 const etag=`"${Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')}"`
 const headers=new Headers(response.headers)
 for(const name of ['Content-Length','Content-Encoding','Last-Modified','Content-Range','Accept-Ranges'])headers.delete(name)
 headers.set('Content-Type','text/javascript; charset=utf-8')
 headers.set('ETag',etag)
 headers.set('Cache-Control','public, max-age=300, s-maxage=300, stale-while-revalidate=60')
 const matches=request.headers.get('If-None-Match')?.split(',').some(tag=>tag.trim()==='*'||tag.trim().replace(/^W\//,'')===etag)
 if(matches)return new Response(null,{status:304,headers})
 headers.set('Content-Length',String(bytes.length))
 return new Response(request.method==='HEAD'?null:bytes,{status:200,headers})
}
