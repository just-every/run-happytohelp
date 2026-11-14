import type {Env} from '../../../platform/env'
import type {DurableAuthority} from '../../move-in/types'
import {authority} from '../../move-in/context'
import {assertRehearsal} from '../authority'
import type {OAuthAuthority} from '../../move-in/zendesk-connection/oauth'

/** Passed to the existing OAuth client, including its atomic token-rotation write. */
export function oauthAuthority(env:Env,row:DurableAuthority & {project_id:string;actor_id:string;session_hash:string},assert:()=>Promise<void>):OAuthAuthority {
 return {assert,predicate:()=>authority({...row,id:''}),...(row.authority_mode==='rehearsal'?{rehearsal:{rehearsal_id:row.rehearsal_id!,rehearsal_generation:row.rehearsal_generation!}}:{})}
}
export async function assertDelegated(env:Env,row:DurableAuthority & {project_id:string}){
 if(row.authority_mode==='rehearsal')await assertRehearsal(env,{rehearsal_id:row.rehearsal_id!,rehearsal_generation:row.rehearsal_generation!},row.project_id,'zendesk')
}
