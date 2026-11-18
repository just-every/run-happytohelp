import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
const uuid=(group,n)=>`${group}000000-0000-4000-8000-${String(n).padStart(12,'0')}`
/** Source SQL mutations use legacy column names, never native aliases. */
export async function seedFidelity(insert,connection,{projectId,n,ownerId,conversationId,resolvedId,messageIds,objectDirectory,mediaId}){
 const date='2026-11-17 00:00:00'
 await insert('macros',{id:uuid('d0',n),project_id:projectId,created_by_id:null,title:'Synthetic reply with unknown author',content:'A saved answer whose source author is unknown.',created_at:null,updated_at:date})
 // Same file, second message, different tag/order: one native message_id cannot
 // represent both. Reverse insertion order between tenants.
 const links=[{media_id:mediaId,mediable_type:'App\\Models\\Message',mediable_id:messageIds[1],tag:'attachment',order:2},{media_id:mediaId,mediable_type:'App\\Models\\Message',mediable_id:messageIds[2],tag:'inline',order:1}]
 for(const link of n%2?links:[...links].reverse())await insert('mediables',link)
 // A private note file also linked to a public message must never become a
 // visitor attachment. Bytes are local, including Unicode names and zero bytes.
 for(const [group,bytes,filename,extension,mime] of [['d1',Buffer.from('Private synthetic note bytes\n'),'同名','txt','text/plain'],['d2',Buffer.alloc(0),'empty','txt','text/plain']]){
  const id=uuid(group,n),directory=`${projectId}/synthetic-notes/${group}`
  await mkdir(join(objectDirectory,directory),{recursive:true});await writeFile(join(objectDirectory,directory,`${filename}.${extension}`),bytes)
  await insert('media',{id,disk:'s3',directory,filename,filename_original:`原本-${filename}.${extension}`,extension,mime_type:mime,aggregate_type:'document',size:bytes.length,created_at:date,updated_at:null})
  await insert('mediables',{media_id:id,mediable_type:'App\\Models\\Event',mediable_id:uuid('51',n),tag:'attachment',order:0})
  if(group==='d1')await insert('mediables',{media_id:id,mediable_type:'App\\Models\\Message',mediable_id:messageIds[1],tag:'attachment',order:0})
 }
 // String payload from a genuine MySQL JSON column, Unicode/CRLF and fractional
 // instants; native milliseconds lose exactly the submillisecond component.
 await connection.execute('UPDATE events SET payload=? WHERE id=?',[JSON.stringify('Internal only. 日本語 🙂 e\u0301 مرحبا\r\n`code` \\ quoted "text"'),uuid('51',n)])
 await connection.execute('UPDATE collector_actions SET created_at=? WHERE project_id=?',['2026-11-16 23:59:59.123456',projectId])
}

/** All excluded schema families get local synthetic rows. These rows must
 * never enter a package, context, journal or native store. */
export async function seedExcluded(insert,connection,counts){
 const tables=['telescope_entries','telescope_entries_tags','telescope_monitoring','failed_jobs','waitlist','job_batches','jobs','migrations','elastic_migrations','local_agent_device_authorizations','local_agent_pairings','personal_access_tokens','prompt_plans']
 const defaults={telescope_entries:{uuid:uuid('e0',1),batch_id:uuid('e0',2),type:'synthetic',content:'Synthetic excluded telemetry'},telescope_entries_tags:{entry_uuid:uuid('e0',1),tag:'synthetic-excluded'}}
 for(const table of tables){
  if(counts[table])continue
  const [columns]=await connection.execute('SELECT COLUMN_NAME name,DATA_TYPE type,IS_NULLABLE nullable,COLUMN_DEFAULT fallback,EXTRA extra,CHARACTER_MAXIMUM_LENGTH length FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[table])
  const row={...defaults[table]}
  for(const c of columns){
   if(row[c.name]!==undefined||c.extra.includes('auto_increment'))continue
   if(/int|decimal/.test(c.type))row[c.name]=1
   else if(c.name==='id'||c.name.endsWith('_id'))row[c.name]=uuid('e1',tables.indexOf(table)+1)
   else if(/date|time/.test(c.type))row[c.name]='2026-11-17 00:00:00'
   else if(c.type==='json')row[c.name]=JSON.stringify({synthetic:'excluded'})
   else row[c.name]=('synthetic-excluded-'+table+'-'+c.name).slice(0,c.length??255)
  }
  const [references]=await connection.execute('SELECT COLUMN_NAME col,REFERENCED_TABLE_NAME parent,REFERENCED_COLUMN_NAME target FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL',[table])
  for(const ref of references){const [[parent]]=await connection.query(`SELECT \`${ref.target}\` id FROM \`${ref.parent}\` ORDER BY \`${ref.target}\` LIMIT 1`);row[ref.col]=parent?.id??null}
  await insert(table,row)
 }
}
