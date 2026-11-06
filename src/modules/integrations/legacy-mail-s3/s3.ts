import {canonicalQuery,encodePath,signS3Request} from './sigv4'
import {sourceOf,type LegacyMailS3Config} from './config'

/** A failed S3 request. `code` is a short fixed phrase, never response text, so it can be stored and shown. */
export class S3Error extends Error {constructor(readonly status:number,readonly code:string){super(code)}}
export interface ListedObject {key:string;size:number}
export interface ListPage {objects:ListedObject[];truncated:boolean;next:string|null}
/** One reply is read at most this far: a list page of 1,000 keys is far smaller. */
const MAX_LIST_BYTES=8_000_000

function place(config:LegacyMailS3Config){
 // A dotted bucket name cannot sit in a TLS host name, so it is addressed by path.
 const pathStyle=config.bucket.includes('.')
 return {host:pathStyle?`s3.${config.region}.amazonaws.com`:`${config.bucket}.s3.${config.region}.amazonaws.com`,root:pathStyle?`/${config.bucket}`:''}
}
/** Every request is a signed GET to the one bucket host; the key is checked to sit under a configured prefix and to
 * hold no dot segment, which a URL would resolve to a different key. Nothing here can write or delete. */
async function signedGet(config:LegacyMailS3Config,path:string,query:string){
 const {host}=place(config),headers=await signS3Request({method:'GET',host,path,query,region:config.region,accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey,now:new Date()})
 const response=await fetch(`https://${host}${path}${query?`?${query}`:''}`,{method:'GET',headers,redirect:'manual'})
 if(!response.ok){await response.body?.cancel().catch(()=>{});throw new S3Error(response.status,`s3_status_${response.status}`)}
 return response
}
async function bounded(response:Response,limit:number){
 const length=Number(response.headers.get('content-length')||0)
 if(length>limit){await response.body?.cancel().catch(()=>{});throw new S3Error(200,'object_too_large')}
 const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0
 if(reader)for(;;){
  const {done,value}=await reader.read()
  if(done)break
  size+=value.byteLength
  if(size>limit){await reader.cancel().catch(()=>{});throw new S3Error(200,'object_too_large')}
  chunks.push(value)
 }
 const bytes=new Uint8Array(size);let offset=0
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 return bytes
}
const entity=(value:string)=>value.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|amp|quot|apos));/gi,(_,hex,decimal,name)=>hex||decimal?String.fromCodePoint(parseInt(hex||decimal,hex?16:10)):({lt:'<',gt:'>',amp:'&',quot:'"',apos:"'"} as Record<string,string>)[String(name).toLowerCase()])
const tag=(xml:string,name:string)=>{const match=xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));return match?entity(match[1]):null}
/** ListObjectsV2 for one configured prefix, one page. */
export async function listObjects(config:LegacyMailS3Config,prefix:string,continuationToken?:string):Promise<ListPage>{
 if(prefix!==config.sesPrefix&&prefix!==config.replayPrefix)throw new S3Error(0,'unsafe_prefix')
 const {root}=place(config)
 const query=canonicalQuery([['list-type','2'],['prefix',prefix],...(continuationToken?[['continuation-token',continuationToken] as const]:[])])
 const xml=new TextDecoder().decode(await bounded(await signedGet(config,`${root}/`,query),MAX_LIST_BYTES))
 if(!/<ListBucketResult[\s>]/.test(xml))throw new S3Error(200,'s3_unexpected_list')
 const objects:ListedObject[]=[]
 for(const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)){
  const key=tag(match[1],'Key'),size=Number(tag(match[1],'Size'))
  if(key===null||!Number.isSafeInteger(size)||size<0)throw new S3Error(200,'s3_unexpected_list')
  objects.push({key,size})
 }
 const rest=xml.replace(/<Contents>[\s\S]*?<\/Contents>/g,''),truncated=tag(rest,'IsTruncated')==='true',next=tag(rest,'NextContinuationToken')
 if(truncated&&!next)throw new S3Error(200,'s3_unexpected_list')
 return {objects,truncated,next:truncated?next:null}
}
/** A key that cannot be fetched safely: outside the configured prefixes, or with a segment a URL would collapse. */
export const unsafeKey=(config:LegacyMailS3Config,key:string)=>!sourceOf(config,key)||key.length>1024||/[\u0000-\u001f\u007f]/.test(key)||key.split('/').some(part=>part==='.'||part==='..')
/** The object's exact bytes. */
export async function getObject(config:LegacyMailS3Config,key:string,limit:number){
 if(unsafeKey(config,key))throw new S3Error(0,'unsafe_key')
 return bounded(await signedGet(config,`${place(config).root}/${encodePath(key)}`,''),limit)
}
