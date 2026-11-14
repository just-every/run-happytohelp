#!/usr/bin/env node
import {stat} from 'node:fs/promises';
import {snapshotPackage} from './legacy-export/package.mjs';
import {attachmentsPackage} from './legacy-export/package-media.mjs';
import {repassPackage} from './legacy-export/repass.mjs';
import {parseArgs} from 'node:util';
import {connectLegacy} from './legacy-export/mysql.mjs';
import {extractProject} from './legacy-export/extract.mjs';
import {hydrateObjects} from './legacy-export/attachments.mjs';
import {readBundle,writeBundle} from './legacy-export/files.mjs';
import {classifySnapshot} from './legacy-export/secrets.mjs';
import {parseSince,parseSourceCutoff,validateSourceClock} from './legacy-export/delta.mjs';

const {values,positionals}=parseArgs({allowPositionals:true,options:{
  project:{type:'string'},revision:{type:'string'},'ai-model':{type:'string'},output:{type:'string'},input:{type:'string'},
  'objects-dir':{type:'string'},bucket:{type:'string'},region:{type:'string'},'mail-from-domain':{type:'string'},
  'defer-mail-domain':{type:'boolean'},'chunk-bytes':{type:'string'},'max-row-bytes':{type:'string'},'max-object-bytes':{type:'string'},'max-json-bytes':{type:'string'},'policy-revision':{type:'string'},since:{type:'string'},'source-cutoff':{type:'string'},help:{type:'boolean'},
}});
if(values.help){console.log(`Read-only legacy HappyToHelp export (one project per snapshot):
  node scripts/export-legacy.mjs snapshot --project UUID --revision SOURCE_SHA --mail-from-domain DOMAIN [--ai-model MODEL] [--source-cutoff RECOVERY_TIME_UTC] [--chunk-bytes 4194304] --output snapshot.json-or-directory
  node scripts/export-legacy.mjs snapshot ... --chunk-bytes 4194304 --since PREVIOUS_SOURCE_WATERMARK --source-cutoff FRESH_RECOVERY_TIME_UTC --output delta-snapshot-directory
  node scripts/export-legacy.mjs attachments --input snapshot.json --objects-dir copied-bucket --output import.json
  node scripts/export-legacy.mjs attachments --input snapshot.json --bucket BUCKET --region REGION --output import.json
  node scripts/export-legacy.mjs repass --input exported-package-directory --policy-revision EXPORTER_SHA --output new-package-directory

Snapshot requires LEGACY_MYSQL_HOST, LEGACY_MYSQL_DATABASE, LEGACY_MYSQL_USER, LEGACY_MYSQL_PASSWORD;
optional LEGACY_MYSQL_PORT (3306) and LEGACY_MYSQL_SSL_CA (verified TLS).
S3 requires explicitly scoped LEGACY_AWS_ACCESS_KEY_ID, LEGACY_AWS_SECRET_ACCESS_KEY, optional LEGACY_AWS_SESSION_TOKEN.
--source-cutoff records an externally established recovery bound; without it a clone's wall clock can skip history.
No dotenv, AWS profiles or live discovery. Output paths must not already exist. See docs/LEGACY-EXPORT.md.`);process.exit(0);}
const limit=name=>{if(values[name]===undefined)return undefined;const n=Number(values[name]);if(!Number.isSafeInteger(n)||n<=0)throw Error(`Invalid --${name}`);return n;};
try {
  if(positionals.length!==1||!['snapshot','attachments','repass'].includes(positionals[0])||!values.output)throw Error('Use --help for the explicit steps');
  let bundle;let publishedDirectly=false;
  if(values.since!==undefined&&positionals[0]!=='snapshot')throw Error('--since selects the rows of a snapshot; attachments and repass take the delta package as --input');
  if(values['source-cutoff']!==undefined&&positionals[0]!=='snapshot')throw Error('--source-cutoff belongs to snapshot; attachments and repass preserve the input source cutoff');
  if(positionals[0]==='snapshot'){
    if(!values.project||!values.revision)throw Error('Snapshot requires --project and --revision');
    const since=values.since===undefined?undefined:parseSince(values.since);
    const sourceCutoff=values['source-cutoff']===undefined?undefined:parseSourceCutoff(values['source-cutoff']);
    if(since&&!values['chunk-bytes'])throw Error('--since writes a chunked package directory; add --chunk-bytes');
    const connection=await connectLegacy();
    const options={projectId:values.project,revision:values.revision,aiModel:values['ai-model'],deferMailDomain:values['defer-mail-domain'],mailFromDomain:values['mail-from-domain'],since,sourceCutoff};
    try{if(values['chunk-bytes']){bundle=await snapshotPackage(connection,{...options,output:values.output,chunkBytes:limit('chunk-bytes')});publishedDirectly=true;}else bundle=await extractProject(connection,{...options,maxBytes:limit('max-row-bytes')});}
    finally{await connection.end();}
  }else if(positionals[0]==='repass'){
    if(!values.input||!(await stat(values.input)).isDirectory())throw Error('Repass requires a chunked package directory as --input');
    bundle=await repassPackage(values.input,values.output,{policyRevision:values['policy-revision']});publishedDirectly=true;
  }else{
    if(!values.input)throw Error('Attachments requires --input');
    if((await stat(values.input)).isDirectory()){bundle=await attachmentsPackage(values.input,values.output,{directory:values['objects-dir'],bucket:values.bucket,region:values.region});publishedDirectly=true;}else{
    bundle=await readBundle(values.input,limit('max-json-bytes'));
    if(bundle.format!=='happytohelp-legacy-v1')throw Error('Not a legacy snapshot');
    validateSourceClock(bundle.source);
    classifySnapshot(bundle);
    bundle=await hydrateObjects(bundle,{directory:values['objects-dir'],bucket:values.bucket,region:values.region,maxBytes:limit('max-object-bytes'),maxJsonBytes:limit('max-json-bytes')});}
  }
  if(!publishedDirectly)await writeBundle(values.output,bundle,limit('max-json-bytes'));
  console.log(JSON.stringify({output:values.output,project:bundle.source.projectId,...(bundle.source.since?{since:bundle.source.since}:{}),...(bundle.source.sourceCutoff?{sourceCutoff:bundle.source.sourceCutoff}:{}),watermark:bundle.source.watermark,rows:bundle.source.rowCounts,objects:bundle.objects?.length??0}));
}catch(error){
  // Driver/provider errors may contain hostnames, SQL and credentials. Print only known tool errors.
  if(error.code) console.error(`Legacy export failed (${error.code}); no completed artifact was published.`);
  else console.error(error.message);
  process.exitCode=1;
}
