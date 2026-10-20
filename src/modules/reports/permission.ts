import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {memberAccess} from '../access/gate'
import {BASE_PERMISSIONS,PERMISSIONS,type Permission} from '../access/catalogue'
import {auditStatement,requestSource} from '../audit/record'

/** Reporting doors must be classified explicitly, including built-in operators.
 * Keeping this in the handler also protects newly registered subroutes. */
export async function requireReportPermission(c:Context<AppEnv>,actor:{id:string;projectId:string;role?:string},permission:Permission){
 // scope() just verified the membership role. Owners cannot be narrowed by a
 // custom role; use the catalogue directly and keep existing report scans bounded.
 const access=actor.role==='owner'?{key:'owner',name:'Owner',base:'owner' as const,permissions:new Set(BASE_PERMISSIONS.owner),custom:false}:await memberAccess(c.env.DB,actor.projectId,actor.id)
 if(access?.permissions.has(permission))return access
 await auditStatement(c.env.DB,{projectId:actor.projectId,category:'access',action:'permission.denied',outcome:'refused',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'route',id:`${c.req.method} ${c.req.path}`},detail:{permission}}).run()
 throw new HTTPException(403,{message:`Your role does not allow you to ${PERMISSIONS[permission].toLowerCase()}`})
}
