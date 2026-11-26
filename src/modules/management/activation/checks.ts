import type {Env} from '../../../platform/env'
import {activationConfiguration,type Configuration} from './configuration'
import {adoptProposedSender} from './sender'
import {checkModel} from './model-probe'
import {checkSenderDns} from './mail-probes'
import {checkOwnerMail,usedSignInLink} from './owner-mail'
import {localProbe} from './local-probes'
import {ProbeFailure} from './provider-http'
import {checkLeaseMs,finishCheck,readReceipts,startCheck} from './store'
import {providerObservationMs,type Probe,type Receipt,type StepId} from './types'

/** Steps whose check can make a provider request. Every other check reads this installation's own records only. */
const providerBacked=new Set<StepId>(['model_key','sender_dns','owner_mail'])

/**
 * Whether an automatic check may leave this observation as it is. Any configuration change re-runs it. A provider-backed
 * observation is kept for 15 minutes once done and for 60 seconds otherwise, so polling never repeats provider requests
 * inside those windows. A local observation is re-read until it is done; once done it holds until its configuration
 * changes. A check still inside its lease is left to finish.
 */
async function fresh(env:Env,config:Configuration,id:StepId,row:Receipt|undefined,now:number) {
 if(!row||row.fingerprint!==config.fingerprints[id])return false
 const age=now-row.checked_at
 if(row.state==='checking')return age<=checkLeaseMs
 if(!providerBacked.has(id))return row.state==='done'
 if(age>=(row.state==='done'?providerObservationMs:checkLeaseMs))return false
 // A used sign-in link confirms owner mail from this installation's records alone, so it is never kept waiting.
 return !(id==='owner_mail'&&row.state!=='done'&&await usedSignInLink(env,config))
}

function probe(env:Env,config:Configuration,id:StepId,token:string):Promise<Probe> {
 return id==='model_key'?checkModel(env,config,token):id==='owner_mail'?checkOwnerMail(env,config):id==='sender_dns'?checkSenderDns(env,config):localProbe(env,config,id)
}

/** Run the checks for these steps. The model check requests one short reply with no tool execution. Checks never send mail.
 * The help article step is never observed: it is not a need and does not count. */
export async function runChecks(env:Env,config:Configuration,requested:StepId[],auto:boolean) {
 const ids=requested.filter(id=>id!=='published_article')
 const receipts=auto?await readReceipts(env,config.projectId):[],now=Date.now()
 let adopted:Configuration|null=null
 await Promise.all(ids.map(async id=>{
  if(auto&&await fresh(env,config,id,receipts.find(row=>row.step_id===id),now))return
  const token=await startCheck(env,config,id);if(!token)return
  let result:Probe,observedUnder=config
  try {result=await probe(env,config,id,token)}
  catch(error){result=error instanceof ProbeFailure?error.probe:{state:'unknown',detail:'The check could not complete. Its outcome remains unknown; no provider work was replayed.'}}
  // A verified proposed sender is adopted in the same observation, which then describes the sender now in use.
  if(id==='sender_dns'&&result.state==='done'&&await adoptProposedSender(env,config)) {
   observedUnder=adopted=await activationConfiguration(env,config.projectId)
   result={...result,detail:`${result.detail} Mail now goes out from ${config.proposedSender}.`}
  }
  await finishCheck(env,config,id,token,result,observedUnder)
 }))
 // Owner mail is then observed under the sender mail now goes out from.
 if(adopted&&ids.includes('owner_mail'))await runChecks(env,adopted,['owner_mail'],true)
}
