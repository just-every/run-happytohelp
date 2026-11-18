import type {Env} from '../../../platform/env'
import {HTTPException} from 'hono/http-exception'
import type {MailboxRow} from './types'
export type MailboxMode='live'|'history'
export function mailboxMode(row:Pick<MailboxRow,'cursor_json'>):MailboxMode{return row.cursor_json&&JSON.parse(row.cursor_json).mode==='history'?'history':'live'}
export function requestedMode(value:unknown):MailboxMode{if(value===undefined||value==='live')return 'live';if(value==='history')return 'history';throw new HTTPException(400,{message:'Choose live mail or Import history only'})}
export function requireLiveMailbox(row:MailboxRow){if(mailboxMode(row)==='history')throw new HTTPException(409,{message:'Import history only cannot send or receive live mail. Choose Turn on live mail first.'})}
/** Preserve each existing door's missing/disconnected-mailbox refusal. */
export async function assertLiveMailboxSelection(env:Env,projectId:string,id:string){const row=await env.DB.prepare('SELECT cursor_json FROM mailbox_connections WHERE id=? AND project_id=?').bind(id,projectId).first<MailboxRow>();if(row)requireLiveMailbox(row)}
