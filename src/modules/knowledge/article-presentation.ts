import type {Env} from '../../platform/env'
import {isArticleEligibleForAI} from './public-sources'

/** Bind the owner-facing label to the same publication identity retrieval uses. */
export async function presentArticle(env:Env,projectId:string,row:any){
 const eligible=await isArticleEligibleForAI(env,projectId,row.id,row.publication_version)
 return {...row,categories:JSON.parse(row.categories),categoryIds:JSON.parse(row.categories),
  is_published:row.status==='published',aiEligibility:eligible?'used':row.status==='published'?'recipient_scoped':'not_used'}
}
