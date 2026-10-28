import {createHash} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileRecords} from '@runeditrun/rer/modules/portability/files';

// rer export carries Durable Object storage as a D1 table, so it travels inside the
// archive's schema, content hash and erasure fences. Workerd keeps each namespace's
// instances as SQLite files under .wrangler/state/v3/do/<worker>-<class>/.
export const SNAPSHOT_SCHEMA='happytohelp.durable-objects/1';
const NAMESPACES=[{binding:'CONVERSATIONS',className:'ConversationSocket'}];
// Workerd's alarms/storage metadata and Miniflare's object-id-to-name mapping
// are tooling bookkeeping. Keep KV, external values and application tables in
// the snapshot so unsupported business storage still refuses instead of vanishing.
const INTERNAL=new Set(['_cf_METADATA','_cf_ALARM','__miniflare_do_name']);

const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const cell=value=>value instanceof Uint8Array?{blob:Buffer.from(value).toString('base64')}:typeof value==='bigint'?Number(value):value;
export const snapshotDigest=(namespace,className,records)=>createHash('sha256').update(canonical({namespace,className,records})).digest('hex');

/** Every stored row of every instance of each declared namespace, read from the stopped local state. */
export async function readDurableObjects(root){
 const base=join(root,'.wrangler/state/v3/do');
 let directories=[];
 try{directories=await readdir(base,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
 const snapshots=[];
 for(const {binding,className} of NAMESPACES){
  const records=[];let instances=0;
  for(const directory of directories.filter(entry=>entry.isDirectory()&&entry.name.endsWith(`-${className}`))){
   for(const file of (await readdir(join(base,directory.name))).filter(name=>name.endsWith('.sqlite')).sort()){
    instances++;
    const db=new DatabaseSync(join(base,directory.name,file),{readOnly:true});
    try{
     const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name).filter(name=>!INTERNAL.has(name));
     for(const table of tables)for(const row of db.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all())
      records.push({instance:file.slice(0,-'.sqlite'.length),table,row:Object.fromEntries(Object.entries(row).map(([key,value])=>[key,cell(value)]))});
    }finally{db.close();}
   }
  }
  records.sort((a,b)=>canonical(a)<canonical(b)?-1:1);
  snapshots.push({namespace:binding,className,schema:SNAPSHOT_SCHEMA,instances,records,digest:snapshotDigest(binding,className,records)});
 }
 return snapshots;
}

const literal=value=>value===null?'NULL':typeof value==='number'?String(value):`'${String(value).replaceAll("'","''")}'`;
/**
 * The snapshot row changes only when the stored records do, so exporting a restored
 * copy reproduces the original archive's content exactly. The instance count is
 * informational (empty instances hold no business state) and follows the records.
 */
export function snapshotSql(snapshots,now=Date.now()){
 return snapshots.map(item=>`INSERT INTO durable_object_snapshots(namespace,class_name,schema,instances,records,records_json,digest,captured_at) VALUES(${[item.namespace,item.className,item.schema,item.instances,item.records.length,JSON.stringify(item.records),item.digest,now].map(literal).join(',')}) ON CONFLICT(namespace) DO UPDATE SET class_name=excluded.class_name,schema=excluded.schema,instances=excluded.instances,records=excluded.records,records_json=excluded.records_json,digest=excluded.digest,captured_at=excluded.captured_at WHERE durable_object_snapshots.digest<>excluded.digest OR durable_object_snapshots.schema<>excluded.schema;`).join('\n');
}

/**
 * Checks an archive's Durable Object snapshot before anything is restored: its schema,
 * its digest over the records it carries, and that this release can restore them. No
 * class in this release writes Durable Object storage, so any stored record is refused
 * rather than dropped. An archive made before snapshots existed carries none.
 */
export async function checkArchiveSnapshot(path){
 const found=[];
 for await(const record of fileRecords(path))for(const item of record.items??[])if(item.kind==='row'&&item.table==='durable_object_snapshots')found.push(item.row);
 for(const row of found){
  if(row.schema!==SNAPSHOT_SCHEMA)throw Error(`Restore refused: the archive's Durable Object snapshot uses schema ${row.schema}, which this release cannot read.`);
  let records;
  try{records=JSON.parse(row.records_json);}catch{throw Error('Restore refused: the archive\'s Durable Object snapshot is damaged.');}
  if(!Array.isArray(records)||records.length!==row.records||snapshotDigest(row.namespace,row.class_name,records)!==row.digest)throw Error('Restore refused: the archive\'s Durable Object snapshot does not match its digest.');
  // Older exports included Miniflare's name mapping. Verify their original
  // complete snapshot above before disregarding that exact tooling table.
  // Leave the archived D1 row untouched so its bytes and digest still travel.
  const applicationRecords=records.filter(record=>record?.table!=='__miniflare_do_name');
  if(applicationRecords.length)throw Error(`Restore refused: the archive holds ${applicationRecords.length} ${row.class_name} Durable Object records, and this release keeps no Durable Object storage to restore them into.`);
 }
 return found.map(row=>({namespace:row.namespace,className:row.class_name,instances:row.instances,records:row.records,digest:row.digest}));
}
