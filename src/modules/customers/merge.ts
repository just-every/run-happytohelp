import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {snapshot,fields,fieldsGuard,fingerprint,together,type CompanySnapshot,type Guard,stale} from './model'
import {changed,commitChange,freeDomains} from './mutations'
import {attributes,invalid} from './validation'

export async function mergePreview(env:Env,projectId:string,targetId:string,sourceId:unknown){
 if(typeof sourceId!=='string'||!sourceId||sourceId===targetId)invalid('Choose a different company to merge')
 const [target,source,definitions]=await Promise.all([snapshot(env,projectId,targetId),snapshot(env,projectId,sourceId),fields(env,projectId)])
 const sourceAttributes=JSON.parse(source.company.attributes_json),targetAttributes=JSON.parse(target.company.attributes_json)
 const combined=attributes({...sourceAttributes,...targetAttributes},definitions),conflicts=Object.keys(sourceAttributes).filter(key=>key in targetAttributes&&JSON.stringify(targetAttributes[key])!==JSON.stringify(sourceAttributes[key])).map(fieldId=>({fieldId,target:targetAttributes[fieldId],source:sourceAttributes[fieldId],kept:'target'}))
 const provenance={name:{kept:'target',target:target.company.name,source:source.company.name},attributes:Object.fromEntries(Object.keys(combined).map(key=>[key,key in targetAttributes?'target':'source'])),conflicts,domains:{target:target.domains,source:source.domains},members:{target:target.members,source:source.members},portalCompanyView:{target:!!target.company.portal_company_view,source:!!source.company.portal_company_view,result:!!(target.company.portal_company_view&&source.company.portal_company_view)}}
 const token=await fingerprint({target,source,definitions})
 return {preview:{targetId,sourceId,targetRevision:target.company.revision,sourceRevision:source.company.revision,token,targetName:target.company.name,sourceName:source.company.name,memberCount:target.members.length+source.members.length,sourceMemberCount:source.members.length,domains:[...new Set([...target.domains,...source.domains])].sort(),attributes:combined,conflicts,portalCompanyView:provenance.portalCompanyView.result,provenance},target,source,definitions}
}
export async function mergeCompanies(env:Env,actor:Actor,targetId:string,body:Record<string,any>,guard:Guard){
 const {preview,target,source,definitions}=await mergePreview(env,actor.projectId,targetId,body.sourceId)
 const supplied=typeof body.preview==='string'?body.preview:body.preview?.token??body.previewToken
 if(typeof supplied!=='string'||supplied!==preview.token)throw stale()
 const after=[changed(target,{attributes_json:JSON.stringify(preview.attributes),portal_company_view:preview.portalCompanyView?1:0},preview.domains,[...target.members,...source.members]),changed(source,{merged_into:targetId,portal_company_view:0,attributes_json:'{}'},[],[])]
 return commitChange(env,actor,{action:'merged',before:[target,source],after,provenance:preview.provenance,guard:together(guard,fieldsGuard(actor.projectId,definitions),freeDomains(actor.projectId,preview.domains,[targetId,source.company.id]))})
}
export async function undoCompanyHistory(env:Env,actor:Actor,companyId:string,historyId:string,guard:Guard){
 const history=await env.DB.prepare('SELECT * FROM company_history WHERE project_id=? AND company_id=? AND id=? AND undone_by IS NULL').bind(actor.projectId,companyId,historyId).first<any>()
 if(!history)throw new HTTPException(404,{message:'Undo history not found'})
 const before=JSON.parse(history.before_json) as CompanySnapshot[],expected=JSON.parse(history.after_json) as CompanySnapshot[]
 if(!before.length)throw new HTTPException(409,{message:'Company creation cannot be undone; edit the account instead'})
 const current=await Promise.all(expected.map(s=>snapshot(env,actor.projectId,s.company.id,false)))
 if(JSON.stringify(current)!==JSON.stringify(expected))throw stale()
 const definitions=await fields(env,actor.projectId)
 for(const s of before)attributes(JSON.parse(s.company.attributes_json),definitions)
 const restored=before.map((s,i)=>changed(current[i],{name:s.company.name,attributes_json:s.company.attributes_json,portal_company_view:s.company.portal_company_view,merged_into:s.company.merged_into},s.domains,s.members))
 return commitChange(env,actor,{action:'undone',before:current,after:restored,provenance:{historyId,action:history.action},undoId:historyId,guard:together(guard,fieldsGuard(actor.projectId,definitions),freeDomains(actor.projectId,before.flatMap(s=>s.domains),before.map(s=>s.company.id)),{sql:'EXISTS(SELECT 1 FROM company_history WHERE project_id=? AND id=? AND undone_by IS NULL AND after_json=?)',params:[actor.projectId,historyId,history.after_json]})})
}
