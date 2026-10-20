import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {ticketAuthority} from '../tickets/model'
import {fields,fieldData,fieldsGuard,together,stale} from './model'
import {fieldDefinition,object,validateAttribute,invalid} from './validation'

export const companyFieldRoutes=new Hono<AppEnv>()
const path='/projects/:projectId/company-fields'
companyFieldRoutes.get(path,async c=>{const actor=await scope(c) as Actor;return c.json({fields:(await fields(c.env,actor.projectId)).map(fieldData)})})
for(const method of ['post','patch','delete'] as const)companyFieldRoutes[method](method==='post'?path:`${path}/:fieldId`,async c=>{
 const actor=await scope(c,true) as Actor,authority=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'settings.manage'),existing=await fields(c.env,actor.projectId),id=method==='post'?crypto.randomUUID():c.req.param('fieldId')!,old=existing.find(f=>f.id===id)
 if(method!=='post'&&!old)throw new HTTPException(404,{message:'Company attribute not found'})
 const body=method==='delete'?{}:object(await c.req.json().catch(()=>invalid('Expected a JSON object'))),next=method==='delete'?null:{id,...fieldDefinition({...old,...(old?{options:JSON.parse(old.options_json)}:{}),...body})}
 const used=await c.env.DB.prepare('SELECT id,attributes_json FROM companies WHERE project_id=? ORDER BY id').bind(actor.projectId).all<{id:string;attributes_json:string}>()
 for(const row of used.results){const attrs=JSON.parse(row.attributes_json);if(Object.hasOwn(attrs,id)){if(!next)throw new HTTPException(409,{message:'Clear this attribute from companies before removing its definition'});validateAttribute(next,attrs[id])}}
 const currentValues={sql:`(SELECT json_group_array(json_object('id',id,'attributes_json',attributes_json)) FROM (SELECT id,attributes_json FROM companies WHERE project_id=? ORDER BY id))=?`,params:[actor.projectId,JSON.stringify(used.results)]}
 const guard=together({sql:`EXISTS(${authority.sql})`,params:authority.params},fieldsGuard(actor.projectId,existing),currentValues),receipt=crypto.randomUUID(),db=c.env.DB,accepted='EXISTS(SELECT 1 FROM audit_events WHERE id=?)'
 const claim=db.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data',?,'succeeded','user',?,'dashboard','company_field',?,'{}' WHERE ${guard.sql}`).bind(receipt,actor.projectId,Date.now(),`company.field_${method}`,actor.id,id,...guard.params)
 const write=next?method==='post'?db.prepare(`INSERT INTO company_attribute_definitions(project_id,id,name,type,options_json) SELECT ?,?,?,?,? WHERE ${accepted}`).bind(actor.projectId,id,next.name,next.type,next.options_json,receipt):db.prepare(`UPDATE company_attribute_definitions SET name=?,type=?,options_json=? WHERE project_id=? AND id=? AND ${accepted}`).bind(next.name,next.type,next.options_json,actor.projectId,id,receipt):db.prepare(`DELETE FROM company_attribute_definitions WHERE project_id=? AND id=? AND ${accepted}`).bind(actor.projectId,id,receipt)
 const result=await db.batch([claim,write]);if(!result[0].meta.changes)throw stale()
 return c.json(next?{field:fieldData(next)}:{removed:true},method==='post'?201:200)
})
