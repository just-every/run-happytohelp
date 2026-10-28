import {rerMailboxStatus} from '../../integrations/rer-mailbox'
import type {Env} from '../../../platform/env'
import {aiCeilings} from '../../../platform/limit-config'
import {DEFAULT_WORKSPACE_COLOUR} from '../workspace-colour'
import {keyInstalled,modelProvider,modelSecrets,type Configuration} from './configuration'
import {metadataProviders} from './model-probe'
import {starterMarker,starterProfile,untouched} from './starter'
import {senderSwitch,senderDnsDomain} from './sender'
import type {ActivationFacts,ColourSource,Receipt,SenderRecord} from './types'
import {inboundNeedsCustomDomain} from './inbound-domain'
import {receivingState} from '../../integrations/inbound-capability'

function colour(settings:any):{hex:string;source:ColourSource} {
 const chosen=typeof settings.primary_color==='string'&&/^#[0-9a-f]{6}$/i.test(settings.primary_color)?settings.primary_color.toLowerCase():null
 const hex=chosen||DEFAULT_WORKSPACE_COLOUR
 const fromSite=typeof settings.site_read?.colour==='string'&&settings.site_read.colour.toLowerCase()===hex
 return {hex,source:fromSite?'site':!chosen||settings.derived?.colour===true&&hex===DEFAULT_WORKSPACE_COLOUR?'default':'chosen'}
}
function ceilings(env:Env):ActivationFacts['ceilings'] {
 try {return {...aiCeilings(env),resetUtc:'00:00',source:env.AI_DAILY_CEILINGS?'installation':'defaults'}}
 catch {return null}
}
/** Records from the sender_dns observation, while it still describes the current configuration. */
function senderRecords(config:Configuration,receipts:Receipt[]):SenderRecord[] {
 const row=receipts.find(row=>row.step_id==='sender_dns')
 if(!row?.observation_json||row.fingerprint!==config.fingerprints.sender_dns)return []
 try {const records=JSON.parse(row.observation_json).senderRecords;return Array.isArray(records)?records:[]}catch{return []}
}

/** What the workspace and installation hold now. Reads only; no provider work and no secret values. */
export async function activationFacts(env:Env,config:Configuration,receipts:Receipt[],origin:string):Promise<ActivationFacts> {
 const settings=config.settings,marker=starterMarker(settings)
 const starter=marker?await starterProfile(env,config.projectId,marker.id):null
 const provider=config.mailMode==='local'?null:config.providerName,switched=senderSwitch(settings)
 return {
  workspaceName:String(config.project?.name||''),
  workspaceNamed:!(typeof settings.derived?.name==='string'&&settings.derived.name===config.project?.name),
  website:config.project?.allowed_origin||null,
  colour:colour(settings),
  mail:{managed:await rerMailboxStatus(env,config.projectId),mode:config.mailMode,provider,statusApi:provider==='resend',sender:config.sender,proposedSender:config.proposedSender,senderDnsDomain:senderDnsDomain(config),
   senderSwitch:switched&&switched.to===config.sender?{from:switched.from,to:switched.to,at:new Date(switched.at).toISOString()}:null},
  ai:{assistantId:config.assistant?.id||null,provider:config.provider,secretName:config.secretName,keyInstalled:Object.keys(modelSecrets).some(provider=>keyInstalled(env,provider)),
   checkable:Boolean(config.provider&&metadataProviders.has(config.provider))},
  starterAssistant:starter&&marker?{id:starter.id,name:starter.name,model:starter.model,provider:modelProvider(starter.model),edited:!untouched(starter,marker.seed)}:null,
  inboundAddress:config.email?.inbound_address||null,
  inbound:{enabled:Boolean(config.email?.is_enabled),gateway:typeof env.INBOUND_EMAIL_TOKEN==='string'&&Boolean(env.INBOUND_EMAIL_TOKEN),customDomainRequired:inboundNeedsCustomDomain(config.email?.inbound_address),receiving:(await receivingState(env,config.email?.inbound_address)).reason},
  ceilings:ceilings(env),
  senderRecords:senderRecords(config,receipts),
  widget:{key:String(config.project?.widget_key||''),scriptUrl:new URL('/widget.js',origin).href,apiOrigin:origin},
 }
}
