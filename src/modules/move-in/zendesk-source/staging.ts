import {PULL_LIMITS} from '../types'
import {sourceId} from '../readers/common'
import {ZendeskError} from '../zendesk-connection/errors'
import type {PullContext} from './context'
import {sanitize} from './sanitize'
export type StagedKind='ticket'|'user'|'organization'|'ticket_field'|'article'
export type StagedState='comments'|'ready'|'packed'|'deleted'|'missing'
export const bytesOf=(text:string)=>new TextEncoder().encode(text).length
export function zendeskId(value:unknown){try{return sourceId(value,'zendesk')}catch{throw new ZendeskError('zendesk_response_invalid')}}
export function stage(ctx:PullContext,kind:StagedKind,id:string,state:StagedState,record:unknown,refs?:unknown){
 return ctx.env.DB.prepare('INSERT INTO move_in_zendesk_staged(pull_id,kind,source_id,state,record_json,refs_json,comments_cursor) VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(pull_id,kind,source_id) DO UPDATE SET state=excluded.state,record_json=excluded.record_json,refs_json=excluded.refs_json,comments_cursor=NULL').bind(ctx.pull.id,kind,id,state,record===null?null:JSON.stringify(record),refs===undefined?null:JSON.stringify(refs))
}
/** A record the pull cannot carry is refused by name and never packed. */
export function refuse(ctx:PullContext,kind:StagedKind,id:string,reason:string){
 ctx.statements.push(ctx.env.DB.prepare('DELETE FROM move_in_zendesk_staged WHERE pull_id=? AND kind=? AND source_id=?').bind(ctx.pull.id,kind,id),ctx.env.DB.prepare('INSERT OR REPLACE INTO move_in_zendesk_refusals(pull_id,kind,source_id,reason) VALUES(?,?,?,?)').bind(ctx.pull.id,kind,id,reason))
}
/** Clean and stage one ready record of a kind the reader takes whole. */
export function stageRecord(ctx:PullContext,kind:StagedKind,raw:unknown,shape:(record:any)=>any=record=>record){
 const record=shape(sanitize(raw,ctx.counts as {redacted:number})),id=zendeskId((record as any)?.id)
 if(bytesOf(JSON.stringify({[kind]:record}))>PULL_LIMITS.recordBytes){refuse(ctx,kind,id,`${kind}_size_limit`);return}
 ctx.statements.push(stage(ctx,kind,id,'ready',record))
}
