import type {Env} from '../../platform/env'

/** A workspace is import-only while every published article came from an import and no member has published.
 * Provenance: Move in (`move_in_origins`), the legacy importer ledger (primary-key lookup per article through
 * the few runs, never a scan of its rows) and the Article import page's API import (`knowledge_import_origins`).
 * Member publication is monotonic: one history snapshot published by a member ends it for good. */
const importOnlySql=`SELECT
 EXISTS(SELECT 1 FROM knowledge_articles WHERE project_id=?1 AND status='published')
 AND NOT EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.project_id=?1 AND a.status='published' AND (a.editor_id IS NOT NULL OR NOT (
  EXISTS(SELECT 1 FROM move_in_origins o WHERE o.project_id=?1 AND o.target_kind='article' AND o.target_id=a.id)
  OR EXISTS(SELECT 1 FROM knowledge_import_origins i WHERE i.project_id=?1 AND i.article_id=a.id)
  OR EXISTS(SELECT 1 FROM legacy_import_runs run JOIN legacy_import_rows r ON r.run_id=run.id AND r.source_table IN ('articles','knowledge_articles') AND r.source_id=a.id WHERE r.target_key=a.id))))
 AND NOT EXISTS(SELECT 1 FROM knowledge_article_history h WHERE h.project_id=?1 AND h.editor_id IS NOT NULL AND json_extract(h.snapshot_json,'$.status')='published') AS only_imported`

export async function importedHelpOnly(env:Env,projectId:string):Promise<boolean>{
 return Boolean((await env.DB.prepare(importOnlySql).bind(projectId).first<{only_imported:number}>())?.only_imported)
}
