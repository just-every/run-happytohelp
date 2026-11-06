/** Imported knowledge (dataset documents, published articles) reaches the
 * copied-text index before anyone uses the workspace. The importer writes those
 * rows directly, so their triggers leave every source in knowledge_index_dirty,
 * and the Worker would otherwise rebuild the whole index inline in the first
 * text-bearing request (any workspace page, creating a workspace), which is far
 * more work than one request can do. The rebuild is the Worker's own
 * `updateKnowledgeIndex`, in passes of `sources` dirty sources, each pass
 * committed page by page; a rerun continues where a stopped one ended. */
export async function indexImportedKnowledge(target,projectIds,updateKnowledgeIndex,{sources=100,progress=()=>{}}={}){
  const pending=projectId=>target.env.DB.prepare('SELECT count(*) n FROM knowledge_index_dirty WHERE project_id=?').bind(projectId).first().then(row=>Number(row?.n||0));
  let indexed=0;
  for(const projectId of new Set(projectIds)){
    let before=await pending(projectId);
    while(before>0){
      const clean=await updateKnowledgeIndex(target.env,projectId,sources),after=clean?0:await pending(projectId);
      if(after>=before)throw Error(`Knowledge index made no progress for workspace ${projectId}; rerun the import`);
      indexed+=before-after;progress({step:'knowledge-index',projectId,indexed:before-after,pending:after});
      before=after;await target.renew?.();
    }
  }
  return {sources:indexed,pending:0};
}
