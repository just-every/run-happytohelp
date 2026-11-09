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
 * Everything is written under the workspace's import lease (legacy-import/lease.ts): it is confirmed before and after
 * each upload, and an upload that lands after the lease lapsed is deleted again before the run stops. Each object is
 * recorded in legacy_import_objects for the package run in a batch that asserts the lease; when that batch fails, an
 * object this run uploaded is deleted too. `erasedMedia`: the media of erased contacts (and contacts being erased).
 * Their files are never uploaded; one still in R2 that no native media row holds was uploaded by an earlier run before
 * her media row was journaled, so her erasure could not see it: this run's record of it and the object are removed. One a
 * native media row holds is another person's attachment, which her erasure kept (`heldByNativeMedia`, erased.ts): it stays. One R2 no longer holds was removed
 * by her erasure, and its record stays (the package reconciliation counts it). `withheld`: the other media a delta
 * leaves out (held, skipped, deleted in the seed), which are only left out. */
export async function importObjects(target,root,manifest,runId,{concurrency=1,progress=()=>{},checkOnly=false,mediaRuns=[],withheld=new Set(),erasedMedia=new Set(),heldByNativeMedia,lease}={}){
  if(!checkOnly&&!lease)throw Error('A legacy import uploads only under its workspace lease');
  if(erasedMedia.size&&!heldByNativeMedia)throw Error('Removing erased contacts\' leftover files needs the native media check (erased.ts heldByNativeMedia)');
  let uploaded=0,present=0,removed=0;
  // Contact erasure redacts the media source copy but keeps its journal identity. A repeat must not
  // recreate its file, even though the native media row is gone. The package's media rows sit in the
  // journal runs of its media chunks, so the erased ones are read from those runs, through the journal's
  // primary key, once rather than once per attachment.
  const erased=new Set();
  for(const run of mediaRuns)for(const row of (await target.env.DB.prepare("SELECT source_id FROM legacy_import_rows WHERE run_id=? AND source_table='media' AND source_json='{}'").bind(run).all()).results)erased.add(row.source_id);
  const confirm=async object=>{const {FILES}=target.env,head=await FILES.head(object.key);if(!head)return false;if(head.size!==object.size||(head.checksums?.sha256?hex(head.checksums.sha256):await storedSha256(FILES,object.key))!==object.sha256)throw Error(`Existing R2 object differs: ${object.key}`);return true;};
  // One statement between the lease's assertion and its clearing; a refused batch stops with the lease's own message.
  const leased=async(statement,undo=async()=>{})=>{const {DB}=target.env;try{await DB.batch([lease.assertion(DB),statement,lease.cleared(DB)]);}catch(error){await undo();await lease.confirm();throw error;}};
  await inWaves(manifest.objects,concurrency,async object=>{
    const media=String(object.mediaId);
    if(erasedMedia.has(media)){
      // One a native media row holds (another person's attachment, which her erasure kept) stays.
      if(checkOnly||!await target.env.FILES.head(object.key)||await heldByNativeMedia(target.env.DB,[media],object.key))return;
      await leased(target.env.DB.prepare('DELETE FROM legacy_import_objects WHERE run_id=? AND object_key=?').bind(runId,object.key));
      await target.env.FILES.delete(object.key);removed++;return;
    }
    // A delta withholds the files of conversations it holds, of skipped mail and of files the seed deleted.
    if(erased.has(media)||withheld.has(media))return;
    if(checkOnly){await confirm(object);return;}
    let mine=false;
    if(await confirm(object))present++;
    else{
      await lease.confirm();await putObject(target.env.FILES,packageFile(root,object.file),object,runId);mine=true;
      // Kept only under a live lease: an upload that landed after the lease lapsed (a stall, then an erasure) goes again.
      try{await lease.confirm();}catch(error){await target.env.FILES.delete(object.key);throw error;}
      if(!await confirm(object))throw Error(`Imported R2 object missing: ${object.key}`);uploaded++;
    }
    await leased(target.env.DB.prepare('INSERT OR IGNORE INTO legacy_import_objects VALUES(?,?,?,?)').bind(runId,object.key,object.sha256,object.size),async()=>{if(mine)await target.env.FILES.delete(object.key);});
    if((uploaded+present)%250===0)progress({objects:uploaded+present,uploaded,present});
  },target);
  return {uploaded,present,removed};
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
