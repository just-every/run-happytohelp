import {Hono} from 'hono'
import {bodyLimit} from 'hono/body-limit'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {ticketAuthority,object,fieldAllowed} from '../tickets/model'
import {formDefinition,publicField} from './definition'
import {formFieldGuard} from './field-guard'
import {decodeForm,fieldCatalogue,storedForm} from './store'
import type {StoredField} from './types'
export const formSettings=new Hono<AppEnv>()
formSettings.use('*',bodyLimit({maxSize:2000000,onError:c=>c.json({error:'Request exceeds the form size limit'},413)}))
const path='/projects/:projectId/forms'
formSettings.get(path,async c=>{
 const actor=await scope(c) as Actor,[rows,fields]=await Promise.all([c.env.DB.prepare('SELECT * FROM request_forms WHERE project_id=? ORDER BY updated_at,id').bind(actor.projectId).all<any>(),fieldCatalogue(c.env,actor.projectId)])
 return c.json({data:rows.results.map(decodeForm),fields:fields.filter(publicField).map(f=>({id:f.id,name:f.name,type:f.type,required:!!f.required,options:JSON.parse(f.options_json),validation:JSON.parse(f.validation_json)}))})
})
formSettings.get(`${path}/:formId`,async c=>{const actor=await scope(c) as Actor;return c.json({data:await storedForm(c.env,actor.projectId,c.req.param('formId'))})})
// Version records share the guarded settings transaction and the portable audit
// store. Inspection requires settings authority; public forms expose only current
// published definitions. Old values remain on their original tickets.
formSettings.get(`${path}/:formId/versions`,async c=>{
 const actor=await scope(c,true) as Actor
 const guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash'),source:'dashboard'},'settings.manage')
 const catalogue=await fieldCatalogue(c.env,actor.projectId)
 const rows=await c.env.DB.prepare("SELECT at,actor_id,action,detail_json FROM audit_events WHERE project_id=? AND target_type='request_form' AND target_id=? AND action IN ('form.post','form.put','form.patch','form.delete') ORDER BY at DESC,id DESC LIMIT 100").bind(actor.projectId,c.req.param('formId')).all<any>()
 const versions=rows.results.filter(row=>JSON.parse(row.detail_json).version!==undefined).map(({detail_json,...row})=>({...row,...JSON.parse(detail_json)}))
 if(versions.some(version=>version.fields?.some((field:StoredField)=>{const current=catalogue.find(f=>f.id===field.id);return !fieldAllowed(current??field,guard.access)})))throw new HTTPException(403,{message:'Your role cannot read a field in this form history'})
 return c.json({data:versions})
})
for(const method of ['post','put','patch','delete'] as const)formSettings[method](method==='post'?path:`${path}/:formId`,async c=>{
 const actor=await scope(c,true) as Actor,guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash'),source:'dashboard'},'settings.manage'),formId=method==='post'?crypto.randomUUID():c.req.param('formId')!,previous=method==='post'?null:await storedForm(c.env,actor.projectId,formId),body=method==='delete'?{}:object(await c.req.json())
 if(previous&&method!=='delete'&&body.updatedAt!==previous.updatedAt)throw new HTTPException(409,{message:'Form changed. Reload before saving.'})
 const catalogue=await fieldCatalogue(c.env,actor.projectId),config=method==='delete'?null:formDefinition({...previous,...body},catalogue),at=Math.max(Date.now(),(previous?.updatedAt??0)+1),receipt=crypto.randomUUID(),predicates=[`EXISTS(${guard.sql})`],params:unknown[]=[...guard.params]
 if(previous){predicates.push('EXISTS(SELECT 1 FROM request_forms WHERE project_id=? AND id=? AND updated_at=?)');params.push(actor.projectId,formId,previous.updatedAt)}
 if(config){const fields=formFieldGuard(actor.projectId,config.fields.map(ref=>catalogue.find(f=>f.id===ref.fieldId)!));predicates.push(fields.sql);params.push(...fields.args)}
 const version=JSON.stringify({version:at,previousVersion:previous?.updatedAt??null,config,fields:config?catalogue.filter(field=>config.fields.some(ref=>ref.fieldId===field.id)):[]})
 const statements=[c.env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data',?,'succeeded','user',?,'dashboard','request_form',?,? WHERE ${predicates.join(' AND ')}`).bind(receipt,actor.projectId,at,`form.${method}`,actor.id,formId,version,...params)]
 const accepted='EXISTS(SELECT 1 FROM audit_events WHERE id=?)'
 if(method==='delete')statements.push(c.env.DB.prepare(`DELETE FROM request_forms WHERE project_id=? AND id=? AND ${accepted}`).bind(actor.projectId,formId,receipt))
 else if(method==='post')statements.push(c.env.DB.prepare(`INSERT INTO request_forms(project_id,id,config_json,enabled,updated_at) SELECT ?,?,?,?,? WHERE ${accepted}`).bind(actor.projectId,formId,JSON.stringify(config),config!.enabled?1:0,at,receipt))
 else statements.push(c.env.DB.prepare(`UPDATE request_forms SET config_json=?,enabled=?,updated_at=? WHERE project_id=? AND id=? AND ${accepted}`).bind(JSON.stringify(config),config!.enabled?1:0,at,actor.projectId,formId,receipt))
 const result=await c.env.DB.batch(statements);if(!result[0].meta.changes)throw new HTTPException(409,{message:'Form, fields or permission changed. Reload before saving.'})
 return method==='delete'?c.json({removed:true}):c.json({data:await storedForm(c.env,actor.projectId,formId)},method==='post'?201:200)
})
