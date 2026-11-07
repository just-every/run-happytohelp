/** AWS Signature Version 4 for S3, header authentication, on WebCrypto alone. Only what the reader's read-only
 * requests need: a method, a path, a query and a few headers. Workers cannot set `Host`, so the URL's host is the
 * signed one. Every `x-amz-*` header the request carries is signed with `host`. */
const encoder=new TextEncoder()
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('')
const sha256=async(value:string)=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)))
async function hmac(key:ArrayBuffer|string,data:string){
 const imported=await crypto.subtle.importKey('raw',typeof key==='string'?encoder.encode(key):key,{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return crypto.subtle.sign('HMAC',imported,encoder.encode(data))
}
/** The payload hash of a request with no body. */
export const EMPTY_PAYLOAD_SHA256='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
/** RFC 3986 unreserved characters stay; everything else, `/` included, is percent-encoded once. */
export const rfc3986=(value:string)=>encodeURIComponent(value).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase())
/** Each path segment encoded once with `/` kept, as S3 verifies its canonical URI. */
export const encodePath=(path:string)=>path.split('/').map(rfc3986).join('/')
const byCode=(left:string,right:string)=>left<right?-1:left>right?1:0
/** Query parameters sorted by encoded name then value, each encoded once. */
export const canonicalQuery=(params:readonly (readonly [string,string])[])=>params.map(([name,value])=>[rfc3986(name),rfc3986(value)] as const).sort((a,b)=>byCode(a[0],b[0])||byCode(a[1],b[1])).map(([name,value])=>`${name}=${value}`).join('&')
export const amzDate=(now:Date)=>now.toISOString().replace(/[-:]|\.\d{3}/g,'')

export interface SigningInput {
 method:'GET'|'HEAD'
 host:string
 /** The encoded path as it is sent, starting with `/`. */
 path:string
 /** The canonical query as it is sent, without `?`. */
 query:string
 region:string
 accessKeyId:string
 secretAccessKey:string
 now:Date
 /** Other headers the request carries, all signed. */
 headers?:Record<string,string>
 payloadHash?:string
}
/** The canonical request, the string to sign and the signature, for tests of the signer itself. */
export async function signingSteps(input:SigningInput){
 const payloadHash=input.payloadHash??EMPTY_PAYLOAD_SHA256,date=amzDate(input.now),scopeDate=date.slice(0,8),scope=`${scopeDate}/${input.region}/s3/aws4_request`
 const headers:Record<string,string>={host:input.host,'x-amz-content-sha256':payloadHash,'x-amz-date':date}
 for(const [name,value] of Object.entries(input.headers||{}))headers[name.toLowerCase()]=value.trim().replace(/\s+/g,' ')
 const names=Object.keys(headers).sort(byCode),signedHeaders=names.join(';')
 const canonical=[input.method,input.path,input.query,...names.map(name=>`${name}:${headers[name]}`),'',signedHeaders,payloadHash].join('\n')
 const toSign=['AWS4-HMAC-SHA256',date,scope,await sha256(canonical)].join('\n')
 let key=await hmac('AWS4'+input.secretAccessKey,scopeDate)
 for(const part of [input.region,'s3','aws4_request'])key=await hmac(key,part)
 const signature=hex(await hmac(key,toSign))
 return {canonical,toSign,signature,date,payloadHash,scope,signedHeaders,authorization:`AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`}
}
/** The headers to send, besides `Host`, which fetch takes from the URL. */
export async function signS3Request(input:SigningInput){
 const steps=await signingSteps(input)
 return {...(input.headers||{}),'x-amz-date':steps.date,'x-amz-content-sha256':steps.payloadHash,authorization:steps.authorization}
}
