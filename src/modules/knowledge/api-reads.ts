import {renderKnowledgeFields} from './reference-store'
import {currentTicketReaders} from './readers'
import type {Env} from '../../platform/env'
import type {TokenAuthority} from '../../platform/integration-authority'
import {visibleArticleSql,anonymousReaders,readerSet,literal} from './door'
/** Editor reads require the connected credential's current articles:write scope
 * and the approving principal's current knowledge.edit permission. */
export function apiArticleVisibility(authority:TokenAuthority,contactId:string|undefined,editor:boolean){
 const readers=contactId?readerSet([{kind:'contact',id:contactId}]):anonymousReaders
 if(!editor)return visibleArticleSql('knowledge_articles',readers)
 return `EXISTS(SELECT 1 FROM integration_tokens token JOIN api_credentials credential ON credential.namespace=token.namespace AND credential.id=token.credential_id JOIN memberships membership ON membership.project_id=credential.namespace AND membership.user_id=credential.issuer_id LEFT JOIN member_roles mr ON mr.project_id=membership.project_id AND mr.user_id=membership.user_id LEFT JOIN project_roles role ON role.project_id=membership.project_id AND role.id=mr.role_key WHERE token.namespace=knowledge_articles.project_id AND token.id=${literal(authority.tokenId)} AND token.revoked_at IS NULL AND EXISTS(SELECT 1 FROM json_each(credential.scopes) WHERE value='articles:write') AND (membership.role='owner' OR mr.role_key IS NULL AND membership.role IN ('admin','operator') OR role.base IN ('admin','operator') AND EXISTS(SELECT 1 FROM json_each(role.permissions_json) WHERE value='knowledge.edit') AND (role.knowledge_article_ids IS NULL OR knowledge_articles.id IN (SELECT value FROM json_each(role.knowledge_article_ids)))))`
}
export async function apiArticleRows(env:Env,authority:TokenAuthority,input:{id?:string;contactId?:string;editor:boolean;before?:{time:number;id:string};limit?:number}){
 const filter=apiArticleVisibility(authority,input.contactId,input.editor),before=input.before
 return (await env.DB.prepare(`SELECT * FROM knowledge_articles WHERE project_id=? AND ${filter} ${input.id?'AND id=?':''} ${before?'AND (updated_at<? OR (updated_at=? AND id<?))':''} ORDER BY updated_at DESC,id DESC LIMIT ?`).bind(authority.projectId,...(input.id?[input.id]:[]),...(before?[before.time,before.time,before.id]:[]),input.limit||1).all<any>()).results
}

/** A managed sample delegates authorization and quota admission to the native
 * resource route. Its response still crosses the same current-reader door. */
export async function apiSampleResponse(env:Env,response:Response,resource:string){
 if(!response.ok||!response.headers.get('Content-Type')?.includes('application/json'))return response
 const value:any=await response.json()
 if(Array.isArray(value.data))value.data=await Promise.all(value.data.map((row:any)=>typeof row.project_id==='string'?renderKnowledgeFields(env,row.project_id,row,resource==='conversations'?currentTicketReaders(row.project_id,row.id,{}):anonymousReaders):row))
 const headers=new Headers(response.headers);headers.delete('Content-Length')
 return new Response(JSON.stringify(value),{status:response.status,headers})
}
