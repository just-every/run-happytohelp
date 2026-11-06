import {sourceSetAdmittedSql} from '../knowledge/reference-policy'
import {requireActiveProject} from '../../platform/project-status'
import {cronRoom} from '../../platform/cron-budget'
import type { Env,Job } from '../../platform/env'
import { HTTPException } from 'hono/http-exception'
import { DEFAULT_WORKSPACE_COLOUR } from '../management/workspace-colour'
import {anonymousReaders,type Readers} from '../knowledge/door'
import {modelKnowledgeInput} from '../knowledge/model-door'
import {canonicaliseFields} from '../knowledge/canonicaliser'
import {referenceResult} from '../knowledge/result-fields'

const assetSourcesSql=(asset:string)=>`SELECT 1 FROM brand_generations generation JOIN knowledge_generation_sources source ON source.project_id=generation.project_id AND source.generation_id='brand:'||generation.id WHERE generation.asset_id=${asset}.id AND generation.project_id=${asset}.project_id`
export const brandAssetHasKnowledgeSql=(asset:string)=>`EXISTS(${assetSourcesSql(asset)})`
export const brandAssetKnowledgeSql=(asset:string,readers:Readers)=>sourceSetAdmittedSql(assetSourcesSql(asset).replace('SELECT 1 FROM','SELECT source.source_id FROM'),`${asset}.project_id`,readers)
export function imageType(bytes:Uint8Array){if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)return 'image/png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return 'image/webp';throw new HTTPException(400,{message:'PNG, JPEG or WebP image bytes required'})}
export async function consumeJob(job:Job,env:Env){
 if(job.type!=='brand.generate')return false
 const row=await env.DB.prepare('SELECT g.*,p.name,s.settings_json FROM brand_generations g JOIN projects p ON p.id=g.project_id LEFT JOIN project_settings s ON s.project_id=p.id WHERE g.id=? AND g.project_id=?').bind(job.id,job.projectId).first<any>();if(!row||row.state!=='queued')return true
 if(JSON.parse(row.settings_json||'{}').deleted_at||!await env.DB.prepare("SELECT 1 FROM memberships WHERE project_id=? AND user_id=? AND role IN('owner','admin')").bind(row.project_id,row.actor_id).first()){await env.DB.prepare("UPDATE brand_generations SET state='failed',error='Project or requesting authority was revoked' WHERE id=? AND state='queued'").bind(row.id).run();return true}
 if(row.expires_at<=Date.now()){await env.DB.prepare("UPDATE brand_generations SET state='failed',error='Expired before provider dispatch' WHERE id=? AND state='queued'").bind(row.id).run();return true}
 if(!env.OPENAI_API_KEY){await env.DB.prepare("UPDATE brand_generations SET state='failed',error='Image provider is not configured' WHERE id=? AND state='queued'").bind(row.id).run();return true}
 const claim=await env.DB.prepare("UPDATE brand_generations SET state='running',started_at=? WHERE id=? AND state='queued' AND EXISTS(SELECT 1 FROM memberships WHERE project_id=brand_generations.project_id AND user_id=brand_generations.actor_id AND role IN('owner','admin')) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=brand_generations.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)").bind(Date.now(),row.id).run();if(!claim.meta.changes)return true
 try{
 const color=JSON.parse(row.settings_json||'{}').primary_color||DEFAULT_WORKSPACE_COLOUR
 // Branding settings and the template remain author-owned. At provider dispatch
 // every prompt still passes the public audience door, using titles/links only.
 const prompt=await modelKnowledgeInput(env,row.project_id,`Create one simple, flat workspace brand mark that reads clearly in a square application icon. Render only the mark on a transparent background; do not add a black, white, or colored canvas behind it. Prefer flat solid shapes and crisp edges, without a tile, glow, or 3D effects unless the user requests them. Workspace name: ${row.name}. Use ${color} as the default mark color, honoring any colors the user explicitly requests. The user's description is: ${row.prompt}`,anonymousReaders,`brand:${row.id}`)
 await requireActiveProject(env,row.project_id)
 const response=await fetch('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:row.model,prompt,size:row.size,quality:row.quality,output_format:'png',background:'transparent',n:1}),signal:AbortSignal.timeout(240000)})
 const providerRequestId=response.headers.get('x-request-id');await env.DB.prepare('UPDATE brand_generations SET provider_request_id=? WHERE id=?').bind(providerRequestId,row.id).run()
 if(!response.ok){await env.DB.prepare('UPDATE brand_generations SET state=?,error=?,completed_at=? WHERE id=?').bind(response.status>=500?'uncertain':'failed',`Provider HTTP ${response.status}`,Date.now(),row.id).run();return true}
 const body=await response.json() as {data?:{b64_json?:string;revised_prompt?:string}[];usage?:unknown};await env.DB.prepare('UPDATE brand_generations SET usage_json=? WHERE id=?').bind(body.usage?JSON.stringify(body.usage):null,row.id).run();await requireActiveProject(env,row.project_id);if(!body.data?.[0]?.b64_json)throw new Error('Provider response omitted image bytes')
 const bytes=Uint8Array.from(atob(body.data[0].b64_json),c=>c.charCodeAt(0));if(bytes.length>20000000)throw new Error('Provider image exceeds size limit');const type=imageType(bytes),assetId=crypto.randomUUID(),key=`${row.project_id}/brand/${assetId}`;await env.FILES.put(key,bytes,{httpMetadata:{contentType:type}})
 const revisedPrompt=body.data[0].revised_prompt?await referenceResult(env,row.project_id,`brand:${row.id}`,await canonicaliseFields(env,row.project_id,body.data[0].revised_prompt),'trace'):null
 await env.DB.batch([env.DB.prepare("INSERT INTO brand_assets SELECT ?,project_id,?,?,?,actor_id,?,NULL FROM brand_generations WHERE id=? AND state='running' AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=brand_generations.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)").bind(assetId,key,type,'generated-brand.png',Date.now(),row.id),env.DB.prepare("UPDATE brand_generations SET state='ready',asset_id=?,usage_json=?,revised_prompt=?,completed_at=? WHERE id=? AND state='running' AND EXISTS(SELECT 1 FROM brand_assets a WHERE a.id=? AND a.project_id=brand_generations.project_id)").bind(assetId,body.usage?JSON.stringify(body.usage):null,revisedPrompt,Date.now(),row.id,assetId)])
 await requireActiveProject(env,row.project_id)
 }catch(error){await env.DB.prepare("UPDATE brand_generations SET state='uncertain',error=?,completed_at=? WHERE id=? AND state='running'").bind(error instanceof Error?error.message:String(error),Date.now(),row.id).run()}
 return true
}
export async function recoverBrandJobs(env:Env){
 if(!cronRoom(env,2))return
 await env.DB.prepare("UPDATE brand_generations SET state=CASE WHEN state='running' THEN 'uncertain' ELSE 'failed' END,error='Expired; provider reconciliation required for running attempts' WHERE state IN('queued','running') AND expires_at<=?").bind(Date.now()).run()
 const rows=await env.DB.prepare("SELECT id,project_id FROM brand_generations WHERE state='queued' AND EXISTS(SELECT 1 FROM projects p WHERE p.id=brand_generations.project_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=brand_generations.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) ORDER BY created_at,id LIMIT 100").all<{id:string;project_id:string}>()
 for(const row of rows.results)await env.JOBS.send({type:'brand.generate',id:row.id,projectId:row.project_id})
}
