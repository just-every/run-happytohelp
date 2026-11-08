import {DatabaseSync} from 'node:sqlite';
import {rm} from 'node:fs/promises';
import path from 'node:path';
import {readPart} from './package.mjs';
import {privateDirectory} from './scratch.mjs';
import {unmarkRetired} from './retire-marker.mjs';

// Tables that stay small whatever the company's volume (one project, its team,
// assistants and knowledge sources) are held in memory, as native mapping reads
// them as arrays. Contacts, conversations, messages and media go to an on-disk
// index, so memory stays bounded by one chunk however large the company is.
const memoryTables=new Set(['projects','users','ais','ai_defaults','datasets','dataset_files']);

/** Build the package's cross-table context in a private temporary directory and
 * return it as a mapping context. close() deletes the index. A delta swept after the legacy
 * retire reads the context's contacts through the retire marker, as its row chunks are. */
export async function packageContext(root,manifest,{timestamp,contactIdentity,transcriptOrder,isMessageMedia,useRelationships},{delta=false,retireMarker}={}){
  const directory=await privateDirectory('context');
  const db=new DatabaseSync(path.join(directory,'context.sqlite'));
  try{
    db.exec(`PRAGMA journal_mode=OFF;PRAGMA synchronous=OFF;
      CREATE TABLE records(tbl TEXT NOT NULL,id TEXT NOT NULL,row TEXT NOT NULL,PRIMARY KEY(tbl,id)) WITHOUT ROWID;
      CREATE TABLE messages(conversation_id TEXT NOT NULL,id TEXT NOT NULL,row TEXT NOT NULL,revision INTEGER,local_id TEXT);
      CREATE TABLE local_ids(conversation_id TEXT NOT NULL,local_id TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(conversation_id,local_id)) WITHOUT ROWID;
      CREATE TABLE media_messages(media_id TEXT PRIMARY KEY,row TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE media_links(media_id TEXT NOT NULL,row TEXT NOT NULL);
      CREATE TABLE identities(project_id TEXT NOT NULL,identity TEXT NOT NULL,created INTEGER NOT NULL,id TEXT NOT NULL,row TEXT NOT NULL);`);
    const tables={},record=db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?)'),message=db.prepare('INSERT INTO messages(conversation_id,id,row,local_id) VALUES(?,?,?,?)'),join=db.prepare('INSERT OR REPLACE INTO media_messages VALUES(?,?)'),link=db.prepare('INSERT INTO media_links VALUES(?,?)'),contact=db.prepare('INSERT INTO identities VALUES(?,?,?,?,?)');
    // Media rows carry the R2 key of their verified attachment, as the exporter assigned it.
    const objectKeys=new Map(manifest.objects.map(o=>[String(o.mediaId),o.key]));
    for(const part of manifest.context){
      const {rows}=unmarkRetired(part.table,await readPart(root,part),retireMarker);
      db.exec('BEGIN');
      for(let row of rows){
        // A delta maps rows as live even after legacy soft-deleted the project: the seed keeps
        // its workspace, so the archive-only cascade of a retired project never hides a sweep.
        // Contacts the retire marked are live too (above); archive-only follows each row's own
        // deleted_at and its conversation's and contact's, never the project's.
        if(delta&&part.table==='projects'){const {deleted_at,...live}=row;row=live;}
        if(part.table==='media'){const key=objectKeys.get(String(row.id));if(!key)throw Error('Package media row has no exported attachment');row.object_key=key;}
        if(memoryTables.has(part.table))(tables[part.table]??=[]).push(row);
        const json=JSON.stringify(row);
        if(row.id!==undefined)record.run(part.table,String(row.id),json);
        if(part.table==='messages'&&!row.deleted_at)message.run(String(row.conversation_id),String(row.id),json,row.local_id?String(row.local_id):null);
        if(part.table==='mediables'&&isMessageMedia(row))join.run(String(row.media_id),json);
        if(part.table==='mediables')link.run(String(row.media_id),json);
        if(part.table==='contacts'){const identity=contactIdentity(row);if(identity!==null)contact.run(String(row.project_id),identity,timestamp(row.created_at),String(row.id),json);}
      }
      db.exec('COMMIT');
    }
    db.exec('CREATE INDEX messages_conversation ON messages(conversation_id);CREATE UNIQUE INDEX messages_id ON messages(id);CREATE INDEX media_links_media ON media_links(media_id);CREATE INDEX identities_owner ON identities(project_id,identity,created,id)');
    // Packages exported before message context carried delivery IDs: read them from the message chunks.
    const localId=db.prepare('UPDATE messages SET local_id=? WHERE id=?');
    for(const part of manifest.chunks)if(part.table==='messages'){const rows=await readPart(root,part);db.exec('BEGIN');for(const row of rows)if(row.local_id)localId.run(String(row.local_id),String(row.id));db.exec('COMMIT');}
    // Revisions follow native transcript order, one conversation in memory at a time;
    // the first message in that order keeps a delivery ID the legacy widget repeated.
    const revise=db.prepare('UPDATE messages SET revision=? WHERE id=?'),owner=db.prepare('INSERT OR IGNORE INTO local_ids VALUES(?,?,?)');let conversation,transcript=[];
    const flush=()=>{transcript.sort(transcriptOrder).forEach((row,i)=>{revise.run(i+1,String(row.id));if(row.local_id)owner.run(conversation,row.local_id,String(row.id));});transcript=[];};
    db.exec('BEGIN');
    for(const row of db.prepare('SELECT conversation_id,local_id,row FROM messages ORDER BY conversation_id').iterate()){if(row.conversation_id!==conversation){flush();conversation=row.conversation_id;}transcript.push({...JSON.parse(row.row),local_id:row.local_id});}
    flush();db.exec('COMMIT');
    const find=db.prepare('SELECT row FROM records WHERE tbl=? AND id=?'),transcriptOf=db.prepare('SELECT row FROM messages WHERE conversation_id=? ORDER BY revision'),revisionOf=db.prepare('SELECT revision FROM messages WHERE id=?'),mediaOf=db.prepare('SELECT row FROM media_messages WHERE media_id=?'),linksOf=db.prepare('SELECT row FROM media_links WHERE media_id=? ORDER BY rowid'),ownerOf=db.prepare('SELECT row FROM identities WHERE project_id=? AND identity=? ORDER BY created,id LIMIT 1'),localOwnerOf=db.prepare('SELECT id FROM local_ids WHERE conversation_id=? AND local_id=?');
    const parsed=result=>result?JSON.parse(result.row):undefined;
    const context=useRelationships({format:'happytohelp-legacy-v1',source:manifest.source,tables},{
      find:(table,id)=>parsed(find.get(table,String(id))),
      messages:{get:id=>{const rows=transcriptOf.all(String(id));return rows.length?rows.map(parsed):undefined;}},
      revisions:{get:id=>revisionOf.get(String(id))?.revision??undefined},
      mediaMessages:{get:id=>parsed(mediaOf.get(String(id)))},
      mediaLinks:{get:id=>{const rows=linksOf.all(String(id));return rows.length?rows.map(parsed):undefined;}},
      identityOwner:(project,identity)=>parsed(ownerOf.get(String(project),identity)),
      localIdOwner:(conversationId,id)=>localOwnerOf.get(conversationId,id)?.id,
    });
    return {context,objectKeys:new Set(objectKeys.values()),async close(){db.close();await rm(directory,{recursive:true,force:true});}};
  }catch(error){db.close();await rm(directory,{recursive:true,force:true});throw error;}
}
