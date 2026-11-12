import assert from 'node:assert/strict'

// The statements as they were before the planner was told which table drives the join. The test runs them
// against the same data as the current ones and requires the same rows in the same order.
const legacyReadback=observed=>`SELECT b.id FROM json_each(?) requested JOIN knowledge_reply_blocks b ON b.project_id=? AND b.fingerprint=json_extract(requested.value,'$.fingerprint') WHERE ${observed} ORDER BY CAST(requested.key AS INTEGER)`
const legacyArticleSources=`SELECT DISTINCT source.block_id,a.id,a.title FROM knowledge_articles a JOIN (SELECT b.id block_id,s.value source_id FROM knowledge_reply_blocks b,json_each(b.sources_json) s WHERE b.project_id=?1 AND b.id IN (SELECT value FROM json_each(?2)) UNION SELECT b.id block_id,gs.source_id FROM knowledge_reply_blocks b JOIN knowledge_generation_sources gs ON gs.project_id=b.project_id AND gs.generation_id=b.generation_id WHERE b.project_id=?1 AND b.id IN (SELECT value FROM json_each(?2))) source ON source.source_id='article:'||a.id WHERE a.project_id=?1`

/** The reference store reads its blocks and their article sources through the unique and primary-key indexes, with the rows the old statements returned. */
export async function referenceReadback({app,p}){
 const sql=(await app.call('/_test/knowledge-sql',{status:200})).data
 const run=async(statement,...args)=>{const result=await app.db.prepare(statement).bind(...args).all();return {rows:result.results,read:result.meta.rows_read}}
 const plan=async(statement,...args)=>(await app.db.prepare('EXPLAIN QUERY PLAN '+statement).bind(...args).all()).results.map(row=>row.detail).join('\n')
 // A workspace holding thousands of blocks and articles.
 const blocks=5000,articles=4200
 await app.db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?) INSERT INTO knowledge_reply_blocks(id,project_id,kind,payload_json,sources_json,generation_id,author_contact_id,created_at,fingerprint) SELECT 'seed-'||i,?,'text',json_object('text','seed '||i),'[]',NULL,NULL,0,'seed-fp-'||i FROM n`).bind(blocks,p).run()
 await app.db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?) INSERT INTO knowledge_articles(id,project_id,slug,title,content,status,updated_at) SELECT 'art-seed-'||i,?,'slug-'||printf('%05d',i),'Seed article '||i,'seed','draft',0 FROM n`).bind(articles,p).run()

 // 1. The readback: present, absent, duplicate, and one whose article source was not observed.
 const request=['seed-fp-17','absent-fp','seed-fp-4999','seed-fp-17','seed-fp-300','seed-fp-2500'].map(fingerprint=>({fingerprint,project_id:p,generation_id:null,sources_json:fingerprint==='seed-fp-300'?'["article:never-observed"]':'[]',sourceIdentities:[]}))
 const legacy=await run(legacyReadback(sql.observed),JSON.stringify(request),p),current=await run(sql.readback,JSON.stringify(request),p)
 assert.deepEqual(current.rows,legacy.rows,'the readback returns the old rows in the old order')
 assert.deepEqual(current.rows.map(row=>row.id),['seed-17','seed-4999','seed-17','seed-2500'],'present ones in request order, the duplicate twice, the absent and unobserved ones not at all')
 assert.match(await plan(legacyReadback(sql.observed),JSON.stringify(request),p),/knowledge_blocks_project/,'the old statement walks the workspace')
 const searched=await plan(sql.readback,JSON.stringify(request),p)
 assert.match(searched,/SEARCH b USING INDEX \S+ \(project_id=\? AND fingerprint=\?\)/,'the current statement searches the unique index per requested block')
 assert.doesNotMatch(searched,/knowledge_blocks_project/)
 assert.ok(current.read<legacy.read&&current.read<blocks,`the readback no longer reads the workspace (${legacy.read} rows before, ${current.read} after, ${blocks} blocks)`)
 if(process.env.H2H_REPORT_D1)console.error(`READBACK-ROWS blocks=${blocks} requested=${request.length} before=${legacy.read} after=${current.read}`)

 // 2. createBlocks itself: the same tokens for blocks already stored, new ones for new text, in request order.
 const input=n=>({kind:'text',text:'readback-'+n,sources:[]}),create=async list=>(await app.call('/_test/knowledge-blocks',{body:{project:p,blocks:list.map(input)},status:200})).data.tokens
 const first=await create(Array.from({length:300},(_,n)=>n))
 assert.equal(new Set(first).size,300)
 const before=(await app.first('SELECT count(*) n FROM knowledge_reply_blocks WHERE project_id=?',p)).n
 const second=await create([17,'new-a',250,17,'new-b',3])
 assert.deepEqual([second[0],second[2],second[3],second[5]],[first[17],first[250],first[17],first[3]],'stored blocks keep their tokens, in request order, a duplicate included')
 assert.ok(!first.includes(second[1])&&!first.includes(second[4])&&second[1]!==second[4],'new text gets new blocks')
 assert.equal((await app.first('SELECT count(*) n FROM knowledge_reply_blocks WHERE project_id=?',p)).n,before+2)
 const refused=await app.call('/_test/knowledge-blocks',{body:{project:p,blocks:[{kind:'text',text:'readback-ghost',sources:['article:ghost']}]}})
 assert.equal(refused.status,409,'a block whose article source was never observed is still refused')

 // 3. Article sources of blocks: rows and order of the old statement, without visiting every article.
 const ids=['seed-9','seed-10','seed-11','seed-12']
 const sources={'seed-9':['article:art-seed-5','article:art-seed-1','article:foreign-art','articleXart-seed-9','xarticle:art-seed-3','link:art-seed-2','article:art-seed-4200','article:missing'],'seed-10':['article:art-seed-2','article:art-seed-5'],'seed-11':[]}
 for(const [id,list] of Object.entries(sources))await app.db.prepare('UPDATE knowledge_reply_blocks SET sources_json=? WHERE id=?').bind(JSON.stringify(list),id).run()
 await app.db.prepare("UPDATE knowledge_reply_blocks SET generation_id='gen-readback' WHERE id IN ('seed-11','seed-12')").run()
 await app.db.batch([['gen-readback','article:art-seed-7'],['gen-readback','article:art-seed-3'],['gen-readback','article:art-seed-5'],['gen-readback','answer:other']].map(([generation,source])=>app.db.prepare("INSERT INTO knowledge_generation_sources(generation_id,project_id,source_id,source_version) VALUES(?,?,?,'v1')").bind(generation,p,source)))
 // An article of another workspace that a block names stays out; slugs that sort against the id order test the order.
 await app.db.batch([app.db.prepare("INSERT INTO knowledge_articles(id,project_id,slug,title,content,status,updated_at) VALUES('foreign-art','p-other','a-foreign','Foreign','x','draft',0)"),app.db.prepare("UPDATE knowledge_articles SET slug='aaa-late' WHERE id='art-seed-5'"),app.db.prepare("UPDATE knowledge_articles SET slug='zzz-first-id' WHERE id='art-seed-1'")])
 const legacyArticles=await run(legacyArticleSources,p,JSON.stringify(ids)),currentArticles=await run(sql.articleSources,p,JSON.stringify(ids))
 const perBlock=rows=>Object.fromEntries(ids.map(id=>[id,rows.filter(row=>row.block_id===id).map(row=>row.id)]))
 assert.deepEqual(perBlock(currentArticles.rows),perBlock(legacyArticles.rows),'each block lists the same articles in the same order')
 const key=row=>JSON.stringify([row.block_id,row.id,row.title])
 assert.deepEqual(currentArticles.rows.map(key).sort(),legacyArticles.rows.map(key).sort())
 assert.deepEqual(perBlock(currentArticles.rows),{'seed-9':['art-seed-5','art-seed-4200','art-seed-1'],'seed-10':['art-seed-5','art-seed-2'],'seed-11':['art-seed-5','art-seed-3','art-seed-7'],'seed-12':['art-seed-5','art-seed-3','art-seed-7']})
 assert.match(await plan(legacyArticleSources,p,JSON.stringify(ids)),/SEARCH a USING INDEX \S+ \(project_id=\?\)/,'the old statement visits the workspace articles')
 assert.match(await plan(sql.articleSources,p,JSON.stringify(ids)),/SEARCH a USING INDEX \S+ \(id=\?\)/,'the current statement finds each article by its key')
 assert.ok(currentArticles.read<legacyArticles.read&&currentArticles.read<articles,`article sources no longer read every article (${legacyArticles.read} rows before, ${currentArticles.read} after, ${articles} articles)`)
 if(process.env.H2H_REPORT_D1)console.error(`ARTICLE-SOURCES-ROWS articles=${articles} blocks=${ids.length} before=${legacyArticles.read} after=${currentArticles.read}`)
}
