import type {Env} from '../../platform/env'
import {rehearsalAudit} from './audit'
import type {RehearsalGrant} from './types'
export const getGrant=(env:Pick<Env,'DB'>,id:string)=>env.DB.prepare('SELECT * FROM rehearsal_grants WHERE id=?').bind(id).first<RehearsalGrant>()
/** The closure trigger bumps all delegated run versions in this same transaction.
 * Cleanup has independent, reduction-only authority and cannot reopen a grant. */
export async function closeGrant(env:Pick<Env,'DB'>,g:RehearsalGrant,reason:string){
 if(g.state!=='active')return
 await env.DB.batch([env.DB.prepare("UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=?,closure_reason=?,cleanup_state='pending' WHERE id=? AND state='active' AND generation=?").bind(Date.now(),reason,g.id,g.generation),rehearsalAudit(env.DB,g,'closed',{reason})])
}
