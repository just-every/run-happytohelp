import {mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {credentialColumns,directTables,childScopes} from '../../scripts/legacy-export/scope.mjs'

const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
// Tables native mapping reads across rows, as the exporter's context parts carry them.
// The tables the exporter writes: its project-scoped tables and the rows they reference.
const exportedTables=new Set([...directTables,...Object.keys(childScopes),'users','ai_defaults','article_categories','mediables','media','local_agent_devices','local_agent_grants'])
const contextTables=['projects','users','ais','ai_defaults','contacts','conversations','messages','mediables','datasets','dataset_files','media']

const exported=source=>({...source,tables:Object.fromEntries(Object.entries(source.tables).filter(([table])=>exportedTables.has(table)).map(([table,rows])=>[table,rows.map(row=>Object.fromEntries(Object.entries(row).filter(([column])=>!(credentialColumns[table]||[]).includes(column))))]))})

/** Write a legacy bundle in the exporter's chunked package format: `rowsPerChunk`
 * rows per chunk, context parts, and one file per attachment. Like the exporter,
 * it writes only its own tables and leaves out credential columns; it returns the
 * bundle as exported. With `delta` ({since, tables}), it writes a delta as
 * `snapshot --since` does: only `delta.tables` in its row chunks and attachments,
 * and the whole of `source` as context (media context: the delta's media). */
export async function writeLegacyPackage(root,source,{rowsPerChunk=2,delta}={}){
 await mkdir(root,{recursive:true})
 const whole=exported(source),bundle=delta?exported({...source,tables:delta.tables}):whole
 const chunks=[],context=[],objects=[],write=async(file,rows,table,list)=>{const bytes=JSON.stringify(rows);await writeFile(join(root,file),bytes);list.push({table,count:rows.length,file,bytes:Buffer.byteLength(bytes),sha256:sha(bytes)})}
 for(const [table,rows] of Object.entries(bundle.tables))for(let i=0;i<rows.length;i+=rowsPerChunk)await write(`rows-${String(chunks.length).padStart(6,'0')}.json`,rows.slice(i,i+rowsPerChunk),table,chunks)
 for(const table of contextTables){const rows=table==='media'?bundle.tables.media:whole.tables[table];if(rows?.length)await write(`context-${String(context.length).padStart(6,'0')}.json`,rows,table,context)}
 for(const object of bundle.objects||[]){const media=bundle.tables.media?.find(row=>row.object_key===object.key);if(!media)continue;const bytes=Buffer.from(object.dataBase64,'base64'),file=`object-${String(objects.length).padStart(6,'0')}.bin`;await writeFile(join(root,file),bytes);objects.push({key:object.key,mediaId:media.id,file,sha256:sha(bytes),size:bytes.length})}
 const rowCounts=Object.fromEntries(Object.entries(bundle.tables).map(([table,rows])=>[table,rows.length]))
 const manifest={format:'happytohelp-legacy-chunks-v1',source:{...bundle.source,rowCounts,attachments:objects.map(o=>({key:o.key,mediaId:o.mediaId})),...(delta?{since:delta.since}:{})},chunks,context,objects,mediaBytes:objects.reduce((n,o)=>n+o.size,0),attachmentsComplete:true}
 await writeFile(join(root,'manifest.json'),JSON.stringify(manifest))
 return {manifest,manifestSha256:sha(JSON.stringify(manifest)),bundle}
}
