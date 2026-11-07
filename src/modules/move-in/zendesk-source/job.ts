import type {Env} from '../../../platform/env'
import {ZendeskError} from '../zendesk-connection/errors'
import {accessToken} from '../zendesk-connection/oauth'
import {applyStep,reviewStep} from './approval'
import {readComments,readPeople} from './comments'
import {Deferred,type PullContext} from './context'
import {enqueuePull} from './notify'
import {packBatch} from './packing'
import {claimPull,getPull,HOLD_MS,json,pullAllowed,savePull,stopPull,type Phase,type PullRow} from './pull-store'
import {readArticles,readFields,readOrganizations,readTickets,readUsers} from './reading'
const reads:Partial<Record<Phase,(ctx:PullContext)=>Promise<void>>>={fields:readFields,articles:readArticles,organizations:readOrganizations,users:readUsers,tickets:readTickets,comments:readComments,people:readPeople,packing:packBatch}
/** One bounded step of a pull per queue message: a few Zendesk reads, one packed
 * batch, or review and apply bookkeeping. Each step commits a durable checkpoint. */
export async function advancePull(env:Env,id:string,projectId:string){
 const found=await getPull(env,id),now=Date.now()
 if(!found||found.project_id!==projectId||found.error||['applied','abandoned'].includes(found.state))return
 if(found.next_at>now){await enqueuePull(env,found,found.next_at-now);return}
 if(found.lease_until&&found.lease_until>now){await enqueuePull(env,found,found.lease_until-now+1000);return}
 const pull=await claimPull(env,found,now,HOLD_MS);if(!pull)return
 if(!await pullAllowed(env,pull)){await stopPull(env,pull,'import_authority_revoked');return}
 const ctx:PullContext={env,pull,token:'',cursor:json(pull.cursor_json,{}),counts:{redacted:0,...json(pull.counts_json,{})},incremental:json(pull.incremental_json,[]),resume:json(pull.resume_json,{}),statements:[],phase:pull.phase,state:pull.state,patch:{},requests:0,more:false}
 try{
  const read=pull.state==='pulling'?reads[pull.phase]:undefined
  if(read){if(pull.phase!=='packing'){const access=await accessToken(env,pull.project_id);if(access.connection.subdomain!==pull.subdomain)throw new ZendeskError('zendesk_connection_changed');ctx.token=access.token}await read(ctx)}
  else if(pull.state==='reviewing')await reviewStep(ctx)
  else if(pull.state==='applying')await applyStep(ctx)
 }catch(error){
  if(error instanceof Deferred)ctx.nextAt=Date.now()+error.waitMs
  else{const code=error instanceof ZendeskError?(error.status?`${error.code}:${error.status}`:error.code):error instanceof Error?(error.message.startsWith('D1_')?'Pull database operation failed':error.message):'zendesk_pull_failed';await stopPull(env,pull,code);return}
 }
 await commit(env,pull,ctx)
}
async function commit(env:Env,pull:PullRow,ctx:PullContext){
 const patch:Partial<PullRow>={...ctx.patch,state:ctx.state,phase:ctx.phase,cursor_json:JSON.stringify(ctx.cursor),counts_json:JSON.stringify(ctx.counts),incremental_json:JSON.stringify(ctx.incremental),next_at:ctx.nextAt??0}
 if(ctx.state==='pulling'&&!patch.resume_json)patch.resume_json=JSON.stringify(ctx.resume)
 try{await savePull(env,pull,patch,ctx.statements)}
 catch(error){const current=await getPull(env,pull.id);if(current&&current.version!==pull.version)return;await stopPull(env,pull,error instanceof Error&&error.message.includes('IMPORT_ATOMIC_GUARD')?'import_authority_revoked':'Pull database operation failed');return}
 if(patch.error)return
 if(ctx.nextAt)await enqueuePull(env,pull,ctx.nextAt-Date.now())
 else if(ctx.more||ctx.state!==pull.state)await enqueuePull(env,pull)
}
