import type {Configuration} from './configuration'
import {metadataProviders} from './model-probe'
import {storedSkips} from './skips'
import {checkLeaseMs} from './store'
import type {widgetVisit} from './local-probes'
import {stepIds,stepLabels,stepPaths,providerObservationMs,type ActivationFacts,type ActivationSnapshot,type ActivationStep,type Placement,type ProbeState,type Receipt,type StepId} from './types'

/**
 * What only the owner can do stays under Needs you until it is observed `done`. Sender DNS is one of those only on a
 * hosted Resend installation; another hosted provider has no status API here (a row, not counted) and a local trial
 * hides it. Mail checks count when the installation can send or receive, or when a receipt confirms them.
 * The AI key is the owner's to add until one is installed; a key
 * for a provider with no metadata check here can never be confirmed, so it is a row, not counted. Anything observed
 * `done` counts. The help article is never a need or counted: the assistant also answers from the owner's own site,
 * so whether an article is published says nothing about whether it can answer.
 */
function placement(id:StepId,state:ProbeState,config:Configuration,facts:ActivationFacts):{placement:Placement;applicable:boolean} {
 const done=state==='done',local=config.environment==='local'
 if(id==='model_key') {
  const unconfirmable=!done&&Boolean(config.provider)&&!metadataProviders.has(config.provider!)&&typeof config.key==='string'&&Boolean(config.key.trim())
  return unconfirmable?{placement:'set',applicable:false}:{placement:done?'set':'needs_you',applicable:true}
 }
 if(id==='published_article')return {placement:'hidden',applicable:false}
 if(id==='widget_seen')return {placement:done?'set':'needs_you',applicable:true}
 if(id==='sender_dns') {
  if(local)return {placement:done?'set':'hidden',applicable:done}
  const resend=config.providerName==='resend'
  return {placement:resend&&!done?'needs_you':'set',applicable:resend||done}
 }
 if(id==='owner_mail')return {placement:'set',applicable:done||(!local&&config.mailMode==='remote')}
 if(id==='inbound_address') {
  const {enabled,gateway,customDomainRequired,receiving}=facts.inbound
  const canReceive=Boolean(facts.mail.managed)||(!local&&enabled&&gateway&&Boolean(facts.inboundAddress)&&!customDomainRequired&&receiving!=='local')
  return {placement:'set',applicable:done||canReceive}
 }
 return {placement:'set',applicable:true}
}

/**
 * A skip moves a need to `skipped` and out of the count. An observation always beats it: a `done` step is a confirmed,
 * counted row, and a `failed` one (a rejected key) stays under Needs you, because a problem is not hidden by a skip.
 * A step that is not a need now (local DNS, a provider with no status API) is unaffected.
 */
function skipped(placed:{placement:Placement;applicable:boolean},state:ProbeState,skip:boolean) {
 return skip&&placed.placement==='needs_you'&&state!=='done'&&state!=='failed'?{placement:'skipped' as const,applicable:false}:placed
}

/** A receipt as it reads now. Pure: a changed configuration, an expired provider validation or an interrupted check
 * reads as `unknown` without writing anything; the next check replaces it. */
function observed(id:StepId,row:Receipt|undefined,config:Configuration,now:number):Omit<ActivationStep,'placement'|'applicable'> {
 const base={id,label:stepLabels[id],actionHref:`/projects/${config.projectId}/${stepPaths[id]}`}
 if(!row)return {...base,state:'not_checked',checkedAt:null,detail:'Not checked yet.',receiptRef:null}
 const checkedAt=new Date(row.checked_at).toISOString()
 const changed=row.fingerprint!==config.fingerprints[id]
 const stale=row.state==='done'&&['model_key','sender_dns'].includes(id)&&now-row.checked_at>providerObservationMs
 const interrupted=row.state==='checking'&&now-row.checked_at>checkLeaseMs
 if(changed||stale||interrupted)return {...base,state:'unknown',checkedAt,receiptRef:null,
  detail:changed?'Configuration changed since this observation. It is checked again automatically.':stale?'Provider validation is older than 15 minutes. It is checked again automatically.':'The check did not finish. Its outcome is unknown; it is checked again automatically.'}
 return {...base,state:row.state,checkedAt,detail:row.detail,receiptRef:row.receipt_ref}
}

export function activationSnapshot(config:Configuration,receipts:Receipt[],facts:ActivationFacts,visit:Awaited<ReturnType<typeof widgetVisit>>,now=Date.now()):ActivationSnapshot {
 const skips=storedSkips(config.settings)
 const steps=stepIds.map(id=>{
  const stored=observed(id,receipts.find(row=>row.step_id===id),config,now)
  const step=id==='widget_seen'&&visit?{...stored,...visit}:stored
  return {...step,...skipped(placement(id,step.state,config,facts),step.state,skips.has(id))}
 })
 const checkedAt=Math.max(visit?Date.parse(visit.checkedAt):0,...receipts.map(row=>row.checked_at))
 return {projectId:config.projectId,total:8,done:steps.filter(step=>step.state==='done'&&step.applicable).length,applicableTotal:steps.filter(step=>step.applicable).length,
  environment:config.environment,checkedAt:checkedAt?new Date(checkedAt).toISOString():null,steps,facts}
}
