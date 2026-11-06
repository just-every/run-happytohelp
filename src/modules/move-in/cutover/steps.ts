import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'

export const SOURCES=['zendesk','legacy','email','widget'] as const
export const STATES=['incumbent','seed','retired'] as const
export const RESULTS=['passed','failed','not_run'] as const
export type Source=typeof SOURCES[number]
export type State=typeof STATES[number]
export type CheckResult=typeof RESULTS[number]
const TEXT_LIMIT=2000

export interface NewStep {source:Source;state:State;change:string;undo:string;check:{result:CheckResult;detail:string}}
export interface Step {id:string;source:Source;state:State;change:string;undo:string;check:{result:CheckResult;detail:string};recordedAt:string;recordedBy:{id:string;name:string}}
interface StepRow {id:string;source:Source;state:State;change:string;undo:string;check_result:CheckResult;check_detail:string;recorded_by:string;recorded_at:number;member_name:string|null;member_email:string|null}

const refuse=(message:string)=>new HTTPException(400,{message})
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
const oneOf=<T extends string>(value:unknown,allowed:readonly T[],name:string)=>{if(typeof value!=='string'||!(allowed as readonly string[]).includes(value))throw refuse(`${name} must be one of ${allowed.join(', ')}`);return value as T}
function text(value:unknown,name:string,required:boolean){
 if(value===undefined&&!required)return ''
 if(typeof value!=='string')throw refuse(`${name} must be text`)
 const trimmed=value.trim()
 if(required&&!trimmed)throw refuse(`${name} is required`)
 if(Array.from(trimmed).length>TEXT_LIMIT)throw refuse(`${name} is at most ${TEXT_LIMIT} characters`)
 return trimmed
}

/** The body of a record request, or a 400 that names the first rule it breaks. Nothing is written before it passes. */
export function parseStep(body:unknown):NewStep{
 if(!isObject(body))throw refuse('Send a JSON object')
 const extra=Object.keys(body).find(key=>!['source','state','change','undo','check'].includes(key))
 if(extra)throw refuse(`${extra} is not a field of a cutover step`)
 if(!isObject(body.check))throw refuse('check is required: {"result","detail"}')
 return {
  source:oneOf(body.source,SOURCES,'source'),
  state:oneOf(body.state,STATES,'state'),
  change:text(body.change,'change',true),
  undo:text(body.undo,'undo',true),
  check:{result:oneOf(body.check.result,RESULTS,'check.result'),detail:text(body.check.detail,'check.detail',false)},
 }
}

const columns=`s.id,s.source,s.state,s.change,s.undo,s.check_result,s.check_detail,s.recorded_by,s.recorded_at,u.name member_name,u.email member_email`
function present(row:StepRow):Step{
 return {id:row.id,source:row.source,state:row.state,change:row.change,undo:row.undo,check:{result:row.check_result,detail:row.check_detail},recordedAt:new Date(row.recorded_at).toISOString(),recordedBy:{id:row.recorded_by,name:row.member_name?.trim()||row.member_email||''}}
}

/** One statement for every step of the workspace, newest first; a step recorded in the same millisecond follows insertion. */
export async function listSteps(env:Env,projectId:string):Promise<Step[]>{
 const rows=await env.DB.prepare(`SELECT ${columns} FROM cutover_steps s LEFT JOIN users u ON u.id=s.recorded_by WHERE s.project_id=? ORDER BY s.recorded_at DESC,s.rowid DESC`).bind(projectId).all<StepRow>()
 return rows.results.map(present)
}
export async function getStep(env:Env,projectId:string,id:string){
 const row=await env.DB.prepare(`SELECT ${columns} FROM cutover_steps s LEFT JOIN users u ON u.id=s.recorded_by WHERE s.project_id=? AND s.id=?`).bind(projectId,id).first<StepRow>()
 return row?present(row):null
}
export function insertStep(env:Env,projectId:string,member:string,step:NewStep,id:string,at:number){
 return env.DB.prepare('INSERT INTO cutover_steps(id,project_id,source,state,change,undo,check_result,check_detail,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,projectId,step.source,step.state,step.change,step.undo,step.check.result,step.check.detail,member,at)
}
