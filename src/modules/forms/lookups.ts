import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {resolvePortalActor,portalSessionGuard} from '../portal/identity'
import {loadPublicForm} from './store'

export async function formLookupChoices(env:Env,projectId:string,formId:string,fieldId:string,request:Request){
 const identity=await resolvePortalActor(env,projectId,request)
 if(!identity)throw new HTTPException(401,{message:'Verify your email to choose an account'})
 const {form}=await loadPublicForm(env,projectId,formId),field=form.fields.find(f=>f.id===fieldId)
 if(field?.validation.lookup!=='account')throw new HTTPException(404,{message:'Lookup field is unavailable'})
 const guard=portalSessionGuard(identity),query=new URL(request.url).searchParams.get('query')??''
 if(query.length>120)throw new HTTPException(400,{message:'Search is too long'})
 const result=await env.DB.prepare(`SELECT account.id value,account.name label FROM companies account JOIN contact_companies member ON member.project_id=account.project_id AND member.company_id=account.id WHERE account.project_id=? AND member.contact_id=? AND account.merged_into IS NULL AND instr(lower(account.name),lower(?))>0 AND ${guard.sql} ORDER BY account.name,account.id LIMIT 100`).bind(projectId,identity.actor.contactId??identity.actor.id,query,...guard.args).all()
 return result.results
}
