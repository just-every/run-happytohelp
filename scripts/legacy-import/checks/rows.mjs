import {readManifest} from '../package.mjs';

// Canonical tables an imported company writes, each counted within its project.
const canonical={projects:'id=?',project_settings:'project_id=?',email_settings:'project_id=?',public_project_aliases:'project_id=?',memberships:'project_id=?',
  contacts:'project_id=?',conversations:'project_id=?',messages:'project_id=?',message_authorship:'project_id=?',media:'project_id=?',context_tracked_events:'project_id=?',reporting_legacy_conversations:'project_id=?',
  conversation_buckets:'conversation_id IN (SELECT id FROM conversations WHERE project_id=?)',conversation_notes:'conversation_id IN (SELECT id FROM conversations WHERE project_id=?)',
  conversation_participants:'conversation_id IN (SELECT id FROM conversations WHERE project_id=?)',conversation_ai:'conversation_id IN (SELECT id FROM conversations WHERE project_id=?)',
  ai_profiles:'project_id=?',knowledge_datasets:'project_id=?',knowledge_documents:'version_id IN (SELECT published_version FROM knowledge_datasets WHERE project_id=?)',
  knowledge_articles:'project_id=?',knowledge_categories:'project_id=?',knowledge_article_categories:'article_id IN (SELECT id FROM knowledge_articles WHERE project_id=?)',
  macros:'project_id=?',plugins:'project_id=?',context_collectors:'project_id=?',context_insights:'project_id=?',context_summaries:'project_id=?',context_actions:'project_id=?',
  billing_usage_history:'project_id=?',local_jobs:'project_id=?',local_events:'job_id IN (SELECT id FROM local_jobs WHERE project_id=?)',local_devices:'project_id=?',local_grants:'project_id=?',local_device_settings:'project_id=?'};

/** Per source table: the package's rows against the journal's (mapped and archive-only),
 * the company's canonical rows, its attachments' journal and its holds. */
export async function countRows(target,root,{excludeTables=[]}={}){
  const {manifest,digest}=await readManifest(root),project=String(manifest.source.projectId),q=async(sql,...args)=>(await target.env.DB.prepare(sql).bind(...args).all()).results;
  // One chunk run at a time, through the journal's run key: a whole-package GROUP BY would scan millions of rows in one query.
  const runs=(await q("SELECT id FROM legacy_import_runs WHERE json_extract(source_json,'$.package')=?",digest)).map(r=>r.id),journal={};
  for(const run of runs){for(const r of await q('SELECT source_table t,status s,COUNT(*) n FROM legacy_import_rows WHERE run_id=? GROUP BY 1,2',run))(journal[r.t]??={})[r.s]=(journal[r.t]?.[r.s]||0)+r.n;await target.renew?.();}
  const tables=Object.fromEntries(Object.entries(manifest.source.rowCounts).map(([table,rows])=>[table,{package:rows,journal:Object.values(journal[table]||{}).reduce((a,b)=>a+b,0),mapped:journal[table]?.mapped||0,archivedOnly:journal[table]?.archived_only||0}]));
  const differing=Object.entries(tables).filter(([table,t])=>!excludeTables.includes(table)&&t.journal!==t.package).map(([table])=>table);
  const native={};for(const [table,where] of Object.entries(canonical))native[table]=(await q(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`,project))[0].n;
  const [objects]=await q('SELECT COUNT(*) n,COALESCE(SUM(size),0) bytes FROM legacy_import_objects WHERE run_id=?',`legacy-package:${digest}`);
  const [run]=await q('SELECT state FROM legacy_import_runs WHERE id=?',`legacy-package:${digest}`);
  const holds=Object.fromEntries((await q("SELECT h.source_table t,COUNT(*) n FROM legacy_import_holds h JOIN legacy_import_runs u ON u.id=h.run_id WHERE json_extract(u.source_json,'$.package')=? GROUP BY 1",digest)).map(r=>[r.t,r.n]));
  return {projectId:project,manifestSha256:digest,run:run?.state??null,chunkRuns:runs.length,excluded:excludeTables,journalEqualsPackage:!differing.length,differing,tables,native,objects:{journal:objects.n,bytes:objects.bytes,package:manifest.objects.length},holds};
}

// Tables only the running app writes when it mails, notifies, queues work, calls a provider, collects leads or
// journals a conversation change for the workflow scheduler. The importer writes none of them, so an import must leave each unchanged.
const work=['conversation_outbox','email_deliveries','magic_signins','operator_notifications','operator_notification_activity','native_integration_events','native_integration_intents','integration_deliveries','context_jobs','lead_jobs','leads','brand_generations','csat_surveys','workflow_events'];

/** Whole-installation counts of the side-effect tables, plus datasets scheduled to refresh. */
export async function countWork(target){
  const out={};for(const table of work)out[table]=(await target.env.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n;
  out['knowledge_datasets.next_refresh_at']=(await target.env.DB.prepare('SELECT COUNT(*) n FROM knowledge_datasets WHERE next_refresh_at IS NOT NULL').first()).n;
  return out;
}
