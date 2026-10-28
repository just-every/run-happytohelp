import {contactKeys} from '../../api-integrations/requester-admission'
import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import {retainErasureIdentity,type ErasureIdentity} from '../../move-in/erasure'
import {contactEmails} from './identity'
import {emailEvidenceStatements} from './statements'
/** Close a native write between the admission read and the first transaction.
 * Retain the original snapshot on every retry; after a committed fence, only
 * the resumable erasure path may continue. Never retry an interrupted commit. */
export async function fenceAdmittedIdentity(env:Env,projectId:string,contactId:string,original:ErasureIdentity,statements:D1PreparedStatement[]){
 let current=original
 for(let attempt=0;attempt<3;attempt++){
  const retain=[...await retainErasureIdentity(env,projectId,contactId,original),...(current===original?[]:await retainErasureIdentity(env,projectId,contactId,current))]
  const apiKeys=await contactKeys(env,projectId,contactId)
  try{
   await env.DB.batch([
    env.DB.prepare('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM contacts WHERE project_id=? AND id=? AND email IS ? AND external_id IS ? AND metadata_json IS ?) THEN 1 ELSE 0 END').bind(projectId,contactId,current.email??null,current.external_id??null,current.metadata_json??null),
    ...apiKeys.map(key=>env.DB.prepare('INSERT OR IGNORE INTO api_erased_keys(project_id,digest) VALUES(?,?)').bind(projectId,key.digest)),
    ...retain,...emailEvidenceStatements(env,{projectId,contactId,emails:[...new Set([...contactEmails(original),...contactEmails(current)])]}),...statements,env.DB.prepare('DELETE FROM ik_d1_assertions')
   ]);return
  }catch(error){
   const latest=await env.DB.prepare('SELECT email,external_id,metadata_json FROM contacts WHERE project_id=? AND id=?').bind(projectId,contactId).first<ErasureIdentity>()
   let metadata:any={};try{metadata=JSON.parse(latest?.metadata_json||'{}')}catch{}
   if(!latest||metadata.is_erasing||metadata.is_erased||latest.email===current.email&&latest.external_id===current.external_id&&latest.metadata_json===current.metadata_json)throw error
   current=latest
  }
 }
 throw new HTTPException(409,{message:'Contact changed; retry erasure'})
}
