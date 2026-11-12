import {HTTPException} from 'hono/http-exception'
import {articleSourcesSql,blockReadbackSql,blockSourcesObservedSql,createBlocks} from '../../../src/modules/knowledge/reference-store'
import type {Env} from '../../../src/platform/env'

// The reference store's own statements and entry point, for the readback test (tests/helpers/knowledge/reference-readback.mjs).
export async function knowledgeStatements(request:Request,env:Env,path:string){
 if(path==='/_test/knowledge-sql')return Response.json({readback:blockReadbackSql,observed:blockSourcesObservedSql('requested.value'),articleSources:articleSourcesSql})
 if(path!=='/_test/knowledge-blocks')return undefined
 const {project,blocks}=await request.json<{project:string;blocks:Parameters<typeof createBlocks>[2]}>()
 try{return Response.json({tokens:await createBlocks(env,project,blocks)})}
 catch(error){if(error instanceof HTTPException)return Response.json({error:error.message},{status:error.status});throw error}
}
