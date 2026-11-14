import {mkdir,writeFile,readFile,rename,rm,lstat,copyFile,open,rmdir,chmod} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {extractProject} from './extract.mjs';
import {enrichMedia} from './attachments.mjs';
import {classifySnapshot} from './secrets.mjs';
import {validateSourceClock} from './delta.mjs';

export const PACKAGE_FORMAT='happytohelp-legacy-chunks-v1';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const chunkLimit=4*1024*1024;
export async function publishDirectory(output,build){
  try{await lstat(output);throw Error('Output already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
  const staging=output+'.partial-'+randomUUID();await mkdir(staging,{mode:0o700});
  let reserved=false;
  try{const result=await build(staging);await mkdir(output,{mode:0o700});reserved=true;await rename(staging,output);reserved=false;return result;}catch(e){await rm(staging,{recursive:true,force:true});if(reserved)await rmdir(output).catch(()=>{});throw e;}
}
export function safeFile(root,file){if(typeof file!=='string'||!/^\w[\w.-]*$/.test(file))throw Error('Invalid package filename');return path.join(root,file);}
export async function readPart(root,part){
  if(!Number.isSafeInteger(part.bytes)||part.bytes<2||part.bytes>32*1024*1024)throw Error('Invalid package chunk size');
  const file=await open(safeFile(root,part.file),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const stat=await file.stat();if(!stat.isFile()||stat.size!==part.bytes)throw Error('Package chunk size mismatch');const bytes=Buffer.alloc(part.bytes);let offset=0;while(offset<bytes.length){const read=await file.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)throw Error('Package chunk changed during read');offset+=read.bytesRead;}if((await file.read(Buffer.alloc(1),0,1,offset)).bytesRead||sha(bytes)!==part.sha256)throw Error('Package chunk digest or size mismatch');return JSON.parse(bytes);}finally{await file.close();}
}
export async function readManifest(root){const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));if(manifest.format!==PACKAGE_FORMAT||!Array.isArray(manifest.chunks)||!Array.isArray(manifest.context))throw Error('Invalid chunked legacy package');validateSourceClock(manifest.source);return manifest;}
export async function writePart(root,file,value){const bytes=JSON.stringify(value);await writeFile(safeFile(root,file),bytes,{mode:0o600,flag:'wx'});return {file,bytes:Buffer.byteLength(bytes),sha256:sha(bytes)};}

// Only relationships used by native mapping are held while importing. Payload
// tables (notably AI usage) stay on disk and are processed one bounded chunk at a time.
// Delivery ids travel with message context, so a delta's import sees every earlier message's id;
// delegations carry their conversation, so a delta can tell whose conversation an event is in.
const contextFields={projects:null,users:['id','type','email','deleted_at'],ais:null,ai_defaults:null,
 contacts:['id','project_id','deleted_at','identifier','external_id','created_at'],conversations:['id','project_id','contact_id','deleted_at'],
 messages:['id','project_id','conversation_id','contact_id','agent_id','ai_id','created_at','deleted_at','local_id'],
 mediables:null,datasets:null,dataset_files:['id','dataset_id','deleted_at','updated_at','created_at','markdown','content'],
 support_delegations:['id','project_id','conversation_id','deleted_at'],
 media:null};
export async function snapshotPackage(connection,options){return publishDirectory(options.output,async root=>{
  const chunks=[],context=[],retained={};let rows=[],bytes=2,table,index=0,ctxRows=[],ctxBytes=2,ctxTable,ctxIndex=0;
  const flush=async()=>{if(rows.length){chunks.push({table,count:rows.length,...await writePart(root,`rows-${String(index++).padStart(6,'0')}.json`,rows)});rows=[];bytes=2;}};
  const flushContext=async()=>{if(ctxRows.length){context.push({table:ctxTable,count:ctxRows.length,...await writePart(root,`context-${String(ctxIndex++).padStart(6,'0')}.json`,ctxRows)});ctxRows=[];ctxBytes=2;}};
  const limit=options.chunkBytes??chunkLimit;if(!Number.isSafeInteger(limit)||limit<1024||limit>32*1024*1024)throw Error('Chunk bytes must be between 1024 and 33554432');
  const bundle=await extractProject(connection,{...options,sink:{
    // A delta's chunks carry only its changed rows; context stays whole, except media, whose
    // context is exactly the attachments the package copies and the import uploads.
    async row(t,row,carried=true){table=t;
      if(carried){const size=Buffer.byteLength(JSON.stringify(row))+1;if(size+2>limit)throw Error(`Legacy row exceeds chunk bytes: ${t}`);if(bytes+size>limit)await flush();rows.push(row);bytes+=size;}
      if(t==='projects'||(t==='media'&&carried))(retained[t]??=[]).push(row);
      if(Object.hasOwn(contextFields,t)&&(t!=='media'||carried)){ctxTable=t;const fields=contextFields[t],r=fields?Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]])):row;const n=Buffer.byteLength(JSON.stringify(r))+1;if(ctxBytes+n>limit)await flushContext();ctxRows.push(r);ctxBytes+=n;}
    },async endTable(){await flush();await flushContext();}
  }});
  const attachments=enrichMedia(retained); // Adds deterministic keys to media context below.
  // Media rows were persisted before enrichment. Native mapping reconstructs the
  // same keys from the verified attachment manifest, without altering source rows.
  const manifest={format:PACKAGE_FORMAT,source:{...bundle.source,attachments},chunks,context,objects:[]};
  await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest),{mode:0o600,flag:'wx'});return manifest;
});}
export async function packageContext(root,manifest){const tables={};for(const part of manifest.context){const rows=await readPart(root,part);(tables[part.table]??=[]).push(...rows);}classifySnapshot({tables});
  const entries=enrichMedia(tables);if(JSON.stringify(entries)!==JSON.stringify(manifest.source.attachments||[]))throw Error('Attachment manifest differs from scoped media');return {format:'happytohelp-legacy-v1',source:manifest.source,tables};}
export async function copyPackageRows(input,root,manifest){for(const part of [...manifest.chunks,...manifest.context]){const rows=await readPart(input,part);classifySnapshot({tables:{[part.table]:rows}});await copyFile(safeFile(input,part.file),safeFile(root,part.file));await chmod(safeFile(root,part.file),0o600);}}
