import type {Env} from '../../platform/env'
import {articleVisible,anonymousReaders} from './door'

/** Bind the owner-facing label to the same publication identity retrieval uses. */
export async function presentArticle(env:Env,projectId:string,row:any){
 const eligible=await articleVisible(env,projectId,row.id,anonymousReaders)
 return {...row,categories:JSON.parse(row.categories),categoryIds:JSON.parse(row.categories),
  is_published:row.status==='published',aiEligibility:eligible?'used':row.status==='published'?'recipient_scoped':'not_used'}
}
