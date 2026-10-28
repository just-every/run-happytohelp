import assert from 'node:assert/strict';
import {cp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {command} from '../rer-command.mjs';
import {fileRecords} from '@runeditrun/rer/modules/portability/files';
import {checkArchiveSnapshot,snapshotDigest} from '../../../scripts/installer/durable-objects.mjs';

const metadataName=value=>typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)?value:'[nonstandard name]';
const scalarType=value=>value===null?'null':Array.isArray(value)?'array':typeof value;
async function snapshotMetadata(path){
 const snapshots=[];
 for await(const record of fileRecords(path))for(const item of record.items??[])if(item.kind==='row'&&item.table==='durable_object_snapshots'){
  const row=item.row,records=JSON.parse(row.records_json),tables=new Map();
  if(Array.isArray(records))for(const entry of records){
   const table=metadataName(entry.table),fields=Object.fromEntries(Object.entries(entry.row??{}).map(([key,value])=>[metadataName(key),scalarType(value)]));
   const shape=JSON.stringify({table,fields}),group=tables.get(shape)??{table,count:0,fields};
   group.count++;tables.set(shape,group);
  }
  snapshots.push({recordsAreArray:Array.isArray(records),recordCountMatches:Array.isArray(records)&&records.length===row.records,digestMatches:snapshotDigest(row.namespace,row.class_name,records)===row.digest,tables:[...tables.values()]});
 }
 return snapshots;
}

async function snapshotFailure(directory,args){
 const input=args.indexOf('--input');
 if(args[0]!=='import'||input<0||!args[input+1])return undefined;
 try{await checkArchiveSnapshot(resolve(directory,args[input+1]));return 'valid';}catch(error){
  const message=error instanceof Error?error.message:'';
  if(message.startsWith("Restore refused: the archive's Durable Object snapshot uses schema "))return 'unsupported_schema';
  if(message==="Restore refused: the archive's Durable Object snapshot is damaged.")return 'invalid_records_json';
  if(message==="Restore refused: the archive's Durable Object snapshot does not match its digest."){
   return {reason:'digest_or_record_count_mismatch',snapshots:await snapshotMetadata(resolve(directory,args[input+1]))};
  }
  const records=message.match(/^Restore refused: the archive holds (\d+) [A-Za-z0-9_]+ Durable Object records, and this release keeps no Durable Object storage to restore them into\.$/);
  return records?{reason:'unsupported_records',count:Number(records[1]),snapshots:await snapshotMetadata(resolve(directory,args[input+1]))}:'unclassified_archive_error';
 }
}

// Only known public diagnostic templates may reach test output. Never print
// captured child output, archive values, settings or arbitrary error messages.
function publicError({code,message}){
 const safeCode=/^[a-z_]+$/.test(code??'')?code:'unknown';
 const templates=[
  /^The portability module refused or failed the archive operation \([a-z_]+\)\.$/,
  /^Archive operation refused \(migration_ledger:[a-z_]+(?::[a-zA-Z0-9_.-]+)*\)\.$/,
  /^Restore refused \(schema_mismatch:migration_data\): migration [a-zA-Z0-9_.-]+ changed data after this archive was made, so its rows would skip that change\. Restore an archive made after it\.$/,
  /^Import refused before restore: (?:archive integrity check failed|invalid archive structure|an archive record exceeds the supported size|unsupported or damaged Durable Object snapshot)\.$/,
 ];
 return {code:safeCode,message:typeof message==='string'&&templates.some(pattern=>pattern.test(message))?message:'Unrecognized public diagnostic withheld.'};
}

// The command uses the edition's actual adapter and sources. Only its local
// binding names point at the stopped packaged runtime, sharing the native store.
export async function cliForRuntime(runtime){
 const directory=runtime.directory,source=resolve('.');
 // The artifact's flattened SQL is replaced by the actual source layout so the
 // real collector sees each module migration once. Native state stays in place.
 await rm(join(directory,'migrations'),{recursive:true,force:true});
 for(const name of ['scripts','src','migrations','docs','management','package.json','seed.json','OPERATIONS.json','OPERATIONS.md','ACCEPTANCE.md','rer-setup.json','deploy.json'])await cp(join(source,name),join(directory,name),{recursive:true});
 await symlink(join(source,'node_modules'),join(directory,'node_modules'),'dir');
 const config=JSON.parse(await readFile(join(runtime.directory,'wrangler.json'),'utf8'));
 config.d1_databases[0].migrations_dir='.generated/migrations';
 await writeFile(join(directory,'wrangler.jsonc'),JSON.stringify(config));
 await writeFile(join(directory,'wrangler.json'),JSON.stringify(config));
 return async(args,expected=0)=>{
  const process=command(directory,args);
  try{
   const result=await process.result();
   if(result.code!==expected){
    const snapshot=await snapshotFailure(directory,args);
    assert.equal(result.code,expected,`Rer ${args[0]} exited ${result.code}; expected ${expected}; ${JSON.stringify({errors:result.events.filter(event=>event.event==='error').map(publicError),...(snapshot?{durableObjectSnapshot:snapshot}:{})})}`);
   }
   return result;
  }finally{await process.stop();}
 };
}

export async function passwordSession(runtime,email,password,projectId){
 const response=await fetch(runtime.origin+'/api/identity/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,projectId})});
 assert.equal(response.status,200);return response.json();
}
