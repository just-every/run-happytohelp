import {omitSupportCredentials,omitKnownCredentials,knownCredentials,sanitizable} from './text-policy.mjs';
import {identifier,snapshot,selectRows} from './mysql.mjs';
import {credentialColumns,skippedTables,supportEventTypes,structuredOmissions,morphTables} from './scope.mjs';
import {projectQueries} from './queries.mjs';
import {enrichMedia} from './attachments.mjs';
import {classifyColumns,classifyValue,omitStructured} from './secrets.mjs';
import {readWatermark,deltaScope,inDelta} from './delta.mjs';

export async function extractProject(connection,{projectId,revision,aiModel,mailFromDomain,maxBytes=256*1024*1024,sink,deferMailDomain=false,since,sourceCutoff}) {
  if(!projectId||!revision)throw Error('Explicit --project and --revision are required');
  if(since&&!sink)throw Error('--since writes a chunked package; add --chunk-bytes');
  return snapshot(connection,async()=>{
    // First read inside the snapshot: the database clock, recorded as the next delta's --since.
    const clock=await readWatermark(connection,{sourceCutoff,since});
    const [inventory]=await connection.execute("SELECT TABLE_NAME name,ENGINE engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'");
    const [columns]=await connection.execute('SELECT TABLE_NAME name,COLUMN_NAME col,DATA_TYPE type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY ORDINAL_POSITION');
    const [primary]=await connection.execute("SELECT TABLE_NAME name,COLUMN_NAME col FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME='PRIMARY'");
    const schema=new Map(inventory.map(t=>{const key=primary.filter(p=>p.name===t.name).map(p=>p.col);return [t.name,{engine:t.engine,columns:columns.filter(c=>c.name===t.name),keyed:key.length===1&&key[0]==='id'}];}));
    for(const [table,info]of schema)if(!skippedTables.includes(table))classifyColumns(table,info.columns);
    if(schema.has('mediables')){const [parents]=await connection.execute('SELECT DISTINCT mediable_type FROM mediables');const known=new Set(Object.keys(morphTables).map(t=>'App\\Models\\'+t));if(parents.some(r=>!known.has(r.mediable_type)))throw Error('Unclassified legacy media parent; add an explicit export/archive/omit scope before exporting');}
    const scopes=projectQueries(schema,projectId),tables={},omittedColumns={},rowCounts={},cloneCounts={},scopedCounts={},omittedJsonValueCounts={},omittedTextValueCounts={},repeatedCredentialValueCounts={};let bytes=0;
    const known=await removedCredentials(connection,schema,scopes);const authors=new Set(),authorFields=new Set(['user_id','agent_id','operator_id','invited_by_id','created_by_id','created_by_user_id','modified_by_id']);
    // A delta streams the whole scope (mapping context and count guards stay whole) and marks the rows its chunks carry.
    const delta=since?{since,scope:await deltaScope(connection,schema,scopes,since),authors:new Set()}:null,deltaCounts={};
    for(const [table]of scopes){
      if(table==='users'){const updated=projectQueries(schema,projectId,[...authors]);for(const t of ['users','mediables','media'])if(updated.has(t))scopes.set(t,updated.get(t));}
      const {where,args}=scopes.get(table);
      const info=schema.get(table);if(info.engine!=='InnoDB')throw Error(`Consistent snapshot requires InnoDB: ${table}`);
      const selected=classifyColumns(table,info.columns),omit=credentialColumns[table]||[];
      omittedColumns[table]=info.columns.filter(c=>omit.includes(c.col)).map(c=>c.col);
      const [[count]]=await connection.execute(`SELECT COUNT(*) n FROM ${identifier(table)} WHERE ${where}`,args);cloneCounts[table]=Number(count.n);
      const orderBy=table==='categories'?'_lft,id':info.columns.some(c=>c.col==='id')?'id':selected.map(c=>identifier(c.col)).join(',');
      const rows=[];let n=0;
      for await(const input of selectRows(connection,{table,columns:selected.map(c=>c.col),where,args,orderBy,keyed:info.keyed&&table!=='categories'})){
        const row={...input};for(const c of selected){const v=row[c.col];
          if(v!==null&&c.type==='json'&&typeof v==='string')row[c.col]=JSON.parse(v);
          else if(v!==null&&/^(timestamp|datetime|date)$/.test(c.type))row[c.col]=String(v).replace(' ','T')+(c.type==='date'?'T00:00:00.000Z':'Z');
          else if(Buffer.isBuffer(v))throw Error(`Binary column needs an explicit encoding: ${table}.${c.col}`);
          const sanitized=omitStructured(table,c.col,row[c.col]);row[c.col]=sanitized.value;if(sanitized.omitted)omittedJsonValueCounts[`${table}.${c.col}`]=(omittedJsonValueCounts[`${table}.${c.col}`]||0)+sanitized.omitted;
          const text=omitSupportCredentials(table,c.col,row[c.col]);row[c.col]=text.value;if(text.omitted)omittedTextValueCounts[`${table}.${c.col}`]=(omittedTextValueCounts[`${table}.${c.col}`]||0)+text.omitted;
          if(sanitizable(table,c.col)){const repeated=omitKnownCredentials(row[c.col],known);row[c.col]=repeated.value;if(repeated.omitted)repeatedCredentialValueCounts[`${table}.${c.col}`]=(repeatedCredentialValueCounts[`${table}.${c.col}`]||0)+repeated.omitted;}
          classifyValue(table,c.col,row[c.col]);
        }
        if(table==='projects'&&row.slug&&!deferMailDomain&&(!mailFromDomain||!/^(?=.{1,253}$)[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9-]+$/i.test(mailFromDomain)))throw Error('Project slug requires explicit --mail-from-domain (legacy MAIL_FROM_DOMAIN)');
        if(table==='ais')authors.add(String(row.id));for(const [key,value]of Object.entries(row))if(authorFields.has(key)&&value)authors.add(String(value));
        const carried=!delta||inDelta(table,row,delta);
        if(delta&&carried){deltaCounts[table]=(deltaCounts[table]||0)+1;if(table==='ais')delta.authors.add(String(row.id));for(const [key,value]of Object.entries(row))if(authorFields.has(key)&&value)delta.authors.add(String(value));}
        bytes+=Buffer.byteLength(JSON.stringify(row));if(!sink&&bytes>maxBytes)throw Error('Project rows exceed --max-row-bytes; use chunked directory output');
        if(sink)await sink.row(table,row,carried);else rows.push(row);n++;
      }
      if(n!==cloneCounts[table])throw Error(`Snapshot count mismatch: ${table}`);
      if(process.env.LEGACY_EXPORT_PROGRESS)console.error(JSON.stringify({table,exported:n,clone:cloneCounts[table]}));
      rowCounts[table]=delta?deltaCounts[table]||0:n;if(delta)scopedCounts[table]=n;if(sink)await sink.endTable(table);else tables[table]=rows;
    }
    if((delta?scopedCounts:rowCounts).projects!==1)throw Error('Requested project does not exist or is not readable');
    if((rowCounts.ais||rowCounts.ai_defaults)&&!aiModel)throw Error('AI rows require an explicit --ai-model for native use');
    const source={repository:'happytohelp',revision,exportedAt:new Date().toISOString(),projectId,...(aiModel?{aiModel}:{}),...(mailFromDomain?{mailFromDomain:mailFromDomain.toLowerCase()}:{mailboxPending:true}),omittedJsonPaths:structuredOmissions,omittedJsonValueCounts,omittedTextValueCounts,repeatedCredentialValueCounts,snapshot:'REPEATABLE READ; CONSISTENT SNAPSHOT; READ ONLY; UTC',omittedColumns,excludedTables:inventory.map(t=>t.name).filter(t=>skippedTables.includes(t)),eventTypes:supportEventTypes,rowCounts,cloneCounts,rowBytes:bytes,
      watermark:clock.watermark,snapshotClock:clock.clock,watermarkOverlapSeconds:clock.watermarkOverlapSeconds,
      ...(clock.sourceCutoff?{sourceCutoff:clock.sourceCutoff}:{}),
      ...(delta?{since:since.iso,scopedCounts,deltaParents:{conversations:delta.scope.parents.size,media:delta.scope.media.size}}:{})};
    const bundle={format:'happytohelp-legacy-v1',source,tables};if(!sink)source.attachments=enrichMedia(tables);return bundle;
  });
}

// First read, in the same snapshot: every value the text policy removes from any of the
// project's rendered or derived text, so its repeats elsewhere are removed as well.
async function removedCredentials(connection,schema,scopes){
  const secrets=new Set();
  for(const [table,{where,args}]of scopes){
    const columns=classifyColumns(table,schema.get(table).columns).filter(c=>sanitizable(table,c.col));
    if(!columns.length)continue;
    const {keyed}=schema.get(table),names=columns.map(c=>c.col);
    for await(const row of selectRows(connection,{table,columns:keyed&&!names.includes('id')?['id',...names]:names,where,args,keyed}))for(const c of columns){
      let value=row[c.col];if(value===null)continue;
      if(c.type==='json'&&typeof value==='string')value=JSON.parse(value);
      omitSupportCredentials(table,c.col,omitStructured(table,c.col,value).value,secret=>secrets.add(String(secret)));
    }
  }
  return knownCredentials(secrets);
}
