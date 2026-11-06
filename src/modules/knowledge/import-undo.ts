/** A strict import reversal owns a newly created article, not later native use.
 * Search every workspace for retained reference and generation dependencies. */
export function unusedImportedArticleSql(project:string,article:string){
 const source=`'article:'||${article}`
 return `NOT EXISTS(SELECT 1 FROM knowledge_reply_blocks b,json_each(b.sources_json) s WHERE s.value=${source})
  AND NOT EXISTS(SELECT 1 FROM knowledge_generation_sources WHERE source_id=${source})
  AND NOT EXISTS(SELECT 1 FROM ai_generation_sources WHERE source_id=${source})
  AND NOT EXISTS(SELECT 1 FROM knowledge_translations WHERE article_id=${article})
  AND NOT EXISTS(SELECT 1 FROM knowledge_article_history WHERE project_id=${project} AND article_id=${article} AND editor_id IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM knowledge_feedback WHERE project_id=${project} AND article_id=${article})
  AND NOT EXISTS(SELECT 1 FROM knowledge_events WHERE project_id=${project} AND article_id=${article})
  AND NOT EXISTS(SELECT 1 FROM knowledge_read_receipts WHERE project_id=${project} AND article_id=${article})
  AND NOT EXISTS(SELECT 1 FROM knowledge_slug_redirects WHERE project_id=${project} AND article_id=${article})`
}

/** Run after deletion inside the guarded reversal transaction. Ordinary article
 * deletion retains history; an unused import returns to its exact prior state. */
export function removeUnusedImportedArticle(projectId:string,articleId:string){
 return [
  ...['knowledge_article_publications','knowledge_translation_publications','knowledge_retired_articles'].map(table=>({sql:`DELETE FROM ${table} WHERE project_id=? AND article_id=?`,params:[projectId,articleId]})),
  ...['knowledge_source_index','knowledge_shingles','knowledge_index_dirty'].map(table=>({sql:`DELETE FROM ${table} WHERE project_id=? AND source_id=?`,params:[projectId,'article:'+articleId]})),
 ]
}
