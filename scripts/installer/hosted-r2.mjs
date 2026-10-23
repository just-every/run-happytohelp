import assert from 'node:assert/strict';
import https from 'node:https';
import {Transform} from 'node:stream';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';
import {open,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {cloudflare} from '@runeditrun/rer/modules/deploy-kit/provider';
import {r2ObjectPath} from '@runeditrun/rer/internal/modules/deploy-kit/r2-objects.mjs';

const opaqueEtag=value=>String(value??'').replace(/^W\//,'').replace(/^"|"$/g,'');

// The object API returns the whole object, even for Range requests. Spool one
// object privately so archive parts remain bounded without a preview tunnel.
export function hostedR2({accountId,bucket,token,directory}){
 assert.match(bucket,/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/);
 const api=cloudflare({accountId,token,maxRequests:5000}),file=join(directory,'object.bytes');
 let cached;
 const raw=key=>new Promise((resolve,reject)=>{
  // Keep opaque slash/dot segments and compressed bytes intact; never redirect.
  const request=https.request({hostname:'api.cloudflare.com',port:443,path:'/client/v4/accounts/'+accountId+r2ObjectPath(bucket,key),method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(120000)},response=>{
   if(response.statusCode!==200){response.resume();reject(Error('Hosted object read failed'));return}
   resolve(response);
  });request.on('error',reject);request.end();
 });
 return {
  async list({cursor,prefix}={}){
   const query=new URLSearchParams({per_page:'1000'});if(cursor)query.set('cursor',cursor);if(prefix)query.set('prefix',prefix);
   const page=await api.envelope('/r2/buckets/'+bucket+'/objects?'+query);
   assert.ok(Array.isArray(page.result)&&page.result.length<=1000,'Invalid hosted object inventory');
   assert.ok(!page.result_info?.is_truncated||(typeof page.result_info.cursor==='string'&&page.result_info.cursor&&page.result_info.cursor!==cursor),'Invalid hosted object cursor');
   return {objects:page.result.map(row=>({key:row.key,size:row.size,etag:opaqueEtag(row.etag),httpMetadata:row.http_metadata??{},customMetadata:row.custom_metadata??{}})),truncated:page.result_info?.is_truncated===true,cursor:page.result_info?.cursor};
  },
  async get(key,{range}={}){
   if(cached?.key!==key){
    cached=undefined;await rm(file,{force:true});
    const response=await raw(key),etag=opaqueEtag(response.headers.etag),checksum=createHash('md5');
    // Cloudflare marks some API replies weak without changing their object
    // bytes. Verify ordinary R2 content digests rather than trusting that mark.
    await pipeline(response,new Transform({transform(chunk,encoding,done){checksum.update(chunk);done(null,chunk)}}),createWriteStream(file,{flags:'wx',mode:0o600}));
    const digest=checksum.digest('hex');if(/^[a-f0-9]{32}$/i.test(etag))assert.equal(digest,etag.toLowerCase(),'Hosted object bytes changed');
    cached={key,etag,size:(await stat(file)).size};
   }
   const offset=range?.offset??0,length=range?.length??cached.size;
   assert.ok(Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&offset>=0&&length>=0&&offset+length<=cached.size,'Invalid hosted object range');
   return {etag:cached.etag,async arrayBuffer(){
    const handle=await open(file,'r');try{const bytes=Buffer.alloc(length);let read=0;while(read<length){const result=await handle.read(bytes,read,length-read,offset+read);assert.ok(result.bytesRead,'Truncated hosted object');read+=result.bytesRead}return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}finally{await handle.close()}
   }};
  },
  async dispose(){cached=undefined;await rm(file,{force:true})},
 };
}
