import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inWaves,packageFile} from './package.mjs';

const partBytes=8*1024*1024;
const hex=buffer=>Buffer.from(buffer).toString('hex');
// Whole-object reads: a streamed body crosses the binding proxy one small request per chunk.
async function storedSha256(bucket,key){const object=await bucket.get(key);return object?createHash('sha256').update(Buffer.from(await object.arrayBuffer())).digest('hex'):null;}

/** Upload missing attachments with conditional creation. R2 checks each single-part
 * upload against its SHA-256 and keeps that checksum, so an object is confirmed by
 * its stored checksum; one without it (multipart, or written by something else) is
 * read back whole and hashed. An existing object with other bytes stops the import.
 * Each object is recorded in legacy_import_objects for the package run. */
export async function importObjects(target,root,manifest,runId,{concurrency=1,progress=()=>{},checkOnly=false}={}){
  let uploaded=0,present=0;
  const confirm=async object=>{const {FILES}=target.env,head=await FILES.head(object.key);if(!head)return false;if(head.size!==object.size||(head.checksums?.sha256?hex(head.checksums.sha256):await storedSha256(FILES,object.key))!==object.sha256)throw Error(`Existing R2 object differs: ${object.key}`);return true;};
  await inWaves(manifest.objects,concurrency,async object=>{
    // Contact erasure redacts the media source copy but keeps its journal identity.
    // A repeat must not recreate its file, even though the native media row is gone.
    const erased=await target.env.DB.prepare("SELECT 1 FROM legacy_import_rows WHERE source_table='media' AND source_id=? AND source_json='{}' LIMIT 1").bind(String(object.mediaId)).first();
    if(erased)return;
    if(checkOnly){await confirm(object);return;}
    if(await confirm(object))present++;
    else{await putObject(target.env.FILES,packageFile(root,object.file),object,runId);if(!await confirm(object))throw Error(`Imported R2 object missing: ${object.key}`);uploaded++;}
    await target.env.DB.prepare('INSERT OR IGNORE INTO legacy_import_objects VALUES(?,?,?,?)').bind(runId,object.key,object.sha256,object.size).run();
    if((uploaded+present)%250===0)progress({objects:uploaded+present,uploaded,present});
  },target);
  return {uploaded,present};
}

async function putObject(bucket,filename,object,runId){
  const file=await open(filename,'r');let upload;
  const options={customMetadata:{sha256:object.sha256,legacyImport:runId}};
  try{
    const parts=Math.ceil(object.size/partBytes);
    if(parts>10000)throw Error('Attachment exceeds the multipart part limit');
    // Buffers stay bounded by one part, also across the binding RPC.
    if(parts<=1){const bytes=Buffer.alloc(object.size);await readExact(file,bytes,0);if(!await bucket.put(object.key,bytes,{...options,sha256:object.sha256,onlyIf:{etagDoesNotMatch:'*'}}))throw Error(`Concurrent R2 object write: ${object.key}`);return;}
    // Multipart completion has no condition or whole-object checksum; confirm() reads it back.
    upload=await bucket.createMultipartUpload(object.key,options);const completed=[];
    for(let offset=0,index=1;offset<object.size;offset+=partBytes,index++){const bytes=Buffer.alloc(Math.min(partBytes,object.size-offset));await readExact(file,bytes,offset);completed.push(await upload.uploadPart(index,bytes));}
    await upload.complete(completed);upload=undefined;
  }finally{if(upload)await upload.abort();await file.close();}
}
async function readExact(file,bytes,position){let n=0;while(n<bytes.length){const read=await file.read(bytes,n,bytes.length-n,position+n);if(!read.bytesRead)throw Error('Attachment changed during import');n+=read.bytesRead;}}
