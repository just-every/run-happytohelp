import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {archiveStorage} from './rer-archive.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const strings=value=>Object.fromEntries(Object.entries(value??{}).filter(([,item])=>typeof item==='string'));
function crc32(bytes){
 let result=0xffffffff;
 for(const byte of bytes){result^=byte;for(let i=0;i<8;i++)result=(result>>>1)^(result&1?0xedb88320:0);}
 return (result^0xffffffff)>>>0;
}

// Platform's streaming producer writes stored members, each followed by a data
// descriptor, as the installed rer intake (cli/managed-data-zip.mjs) reads them.
export function managedZip(entries){
 const local=[],central=[];let offset=0;
 for(const [path,value] of entries){
  const name=Buffer.from(path),data=Buffer.isBuffer(value)?value:Buffer.from(value),crc=crc32(data);
  const header=Buffer.alloc(30),descriptor=Buffer.alloc(16),directory=Buffer.alloc(46);
  header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(8,6);header.writeUInt16LE(name.length,26);
  descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(data.length,8);descriptor.writeUInt32LE(data.length,12);
  directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(8,8);
  directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
  local.push(header,name,data,descriptor);central.push(directory,name);offset+=header.length+name.length+data.length+descriptor.length;
 }
 const end=Buffer.alloc(22),directory=Buffer.concat(central);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}

/**
 * The Managed data download of a Platform-applied installation: one D1 dump with
 * its rer_migrations ledger and the FILES bucket. The download's SQL carries only
 * tables, indexes, views, triggers and rows, so the FTS5 search index (a virtual
 * table and its shadow tables) is listed as omitted; restore rebuilds it.
 */
export async function managedDownload(root,{extraSql=''}={}){
 return archiveStorage(root,async({DB,FILES})=>{
  const query=async sql=>(await DB.prepare(sql).all()).results;
  const kinds=new Map((await query('PRAGMA table_list')).map(row=>[row.name,row.type]));
  const schema=await query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND substr(lower(name),1,7)<>'sqlite_' AND substr(lower(name),1,4)<>'_cf_' ORDER BY name");
  const omittedTables=schema.filter(row=>row.type==='table'&&kinds.get(row.name)!=='table').map(row=>row.name);
  // Every table definition precedes the rows, so a row's foreign keys name existing tables.
  const tables=schema.filter(row=>row.type==='table'&&!omittedTables.includes(row.name));
  let sql='PRAGMA defer_foreign_keys=ON;\n'+tables.map(table=>table.sql+';\n').join('');
  for(const table of tables){
   const columns=(await query(`PRAGMA table_xinfo(${quote(table.name)})`)).filter(column=>!column.hidden);
   for(const row of await query(`SELECT ${columns.map((column,i)=>`quote(${quote(column.name)}) AS c${i}`).join(',')} FROM ${quote(table.name)} ORDER BY rowid`))
    sql+=`INSERT INTO ${quote(table.name)} VALUES(${columns.map((_,i)=>row['c'+i]).join(',')});\n`;
  }
  for(const object of schema.filter(row=>row.type!=='table'&&!omittedTables.includes(row.tbl_name)))sql+=object.sql+';\n';
  const data=Buffer.from(sql+extraSql),migrationLedger=await query('SELECT name,sha256 FROM rer_migrations ORDER BY name');
  const database={binding:'DB',name:'synthetic-happytohelp-1',dumpPath:'data/d1/DB.sql',dumpBytes:data.length,dumpSha256:hash(data),dumpEtag:'synthetic-happytohelp-1',retryCount:0,migrationLedger,omittedTables,consistency:{mode:'paged-read-committed',snapshot:false,limitation:'synthetic-happytohelp-1'}};
  const objects=[],files=[];let cursor;
  do{
   const page=await FILES.list({...(cursor?{cursor}:{}),include:['httpMetadata','customMetadata']});
   for(const {key} of page.objects){
    const object=await FILES.get(key),bytes=Buffer.from(await object.arrayBuffer()),path=`data/r2/FILES/${objects.length+1}`;
    objects.push({key,path,size:bytes.length,sha256:hash(bytes),httpMetadata:strings(object.httpMetadata),customMetadata:strings(object.customMetadata)});files.push([path,bytes]);
   }
   cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
  const bucket={binding:'FILES',objects};
  const manifest={schema:1,kind:'runeditrun-app-data',installationId:'synthetic-happytohelp-1',appName:'synthetic-happytohelp-1',generatedAt:'2026-10-28T00:00:00.000Z',databases:[database],buckets:[bucket],notIncluded:[]};
  return managedZip([['data/d1/DB.sql',data],['data/d1/DB.json',JSON.stringify(database)],['data/d1/DB-migrations.json',JSON.stringify(migrationLedger)],['data/r2/FILES.json',JSON.stringify(bucket)],...files,['README.txt','synthetic-happytohelp-1'],['manifest.json',JSON.stringify(manifest)]]);
 });
}

// The destination's local D1 files, read as bytes without opening SQLite.
export async function databaseBytes(root){
 const directory=join(root,'.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
 const names=await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
 return Object.fromEntries(await Promise.all(names.sort().map(async name=>[name,hash(await readFile(join(directory,name)))])));
}
