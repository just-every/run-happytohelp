import type {Receiving} from '../../integrations/inbound-capability'
export const stepLabels = {
 owner_mail: 'Check a test email arrives', sender_dns: 'Verify your sending address', inbound_address: 'Receive replies by email',
 model_key: 'Connect an AI provider', spend_ceilings: 'Set limits for AI use', published_article: 'Publish a help article',
 widget_origin: 'Choose the website for your widget', widget_seen: 'Open the widget on your website',
} as const
export type StepId = keyof typeof stepLabels
export type ProbeState = 'not_checked'|'checking'|'pending'|'done'|'failed'|'unavailable'|'unknown'
/** Structured data an observation saw, stored with its receipt. Never wording, never secrets. */
export type Observation = {senderRecords?: SenderRecord[]}
export type Probe = {state:ProbeState;detail:string;receiptRef?:string|null;actionHref?:string;observation?:Observation}
export type Receipt = {step_id:StepId;state:ProbeState;fingerprint:string;checked_at:number;detail:string;receipt_ref:string|null;check_token:string;observation_json:string|null}
export const stepIds = Object.keys(stepLabels) as StepId[]
export const providerObservationMs = 15 * 60 * 1000
export const stepPaths:Record<StepId,string> = {
 owner_mail:'email-settings',sender_dns:'email-settings',inbound_address:'email-settings',model_key:'ais',
 spend_ceilings:'ais',published_article:'articles',widget_origin:'widget-settings',widget_seen:'widget-settings',
}

/** `local` is a loopback trial whose mail is suppressed (`localMailOrigin`); everything else is hosted. */
export type Environment = 'local'|'hosted'
/** Where the Setup page shows a step: something only the owner can do, a row under "What we've set", nowhere, or
 * something the owner chose to leave for now (`skipped`, see skips.ts). */
export type Placement = 'needs_you'|'set'|'hidden'|'skipped'

export type ActivationStep = {
 id:StepId; label:string; state:ProbeState; detail:string; checkedAt:string|null; receiptRef:string|null; actionHref:string
 placement:Placement
 /** Counted in `applicableTotal`. A skipped or hidden step is never applicable; every other step that is `done` is. */
 applicable:boolean
}

export type SenderRecord = {type:string; name:string; value:string; status:string}
export type ColourSource = 'site'|'default'|'chosen'

/** Stored or installation facts for the page's rows. Structured values only: no wording, keys, tokens or fingerprints. */
export type ActivationFacts = {
 workspaceName:string
 /** False while the workspace keeps the name setup chose for it, such as My workspace. */
 workspaceNamed:boolean
 /** The project's allowed widget origin. */
 website:string|null
 colour:{hex:string; source:ColourSource}
 /** `local` suppresses email without storage; `statusApi` says whether the provider reports delivery status here.
  * `sender` is the address mail goes out from now; `proposedSender` the workspace's own address whose domain sender_dns
  * checks while mail still goes out from the installation sender; `senderDnsDomain` is the domain sender_dns checks now, which
  * is the chosen sender's own once the owner has set one; `senderSwitch` is set once that domain was verified and mail switched to it from the installation sender. */
 mail:{mode:'local'|'remote'|'unavailable'; managed?:{address:string|null;state:string;configured:boolean;routeActive:boolean;observed:boolean;lastInboundAt:number|null;lastOutboundAcceptanceAt:number|null;error:string|null}|null; provider:'resend'|'cloudflare'|'sendgrid'|'rer'|null; statusApi:boolean; sender:string|null
  proposedSender:string|null; senderDnsDomain:string|null; senderSwitch:{from:string; to:string; at:string}|null}
 /** The assistant the `model_key` step validates (the default visitor assistant) and its provider's secret name.
  * `keyInstalled` is true when the installation holds any supported provider key (presence only, never the key).
  * `checkable` is true when that provider's key can be checked automatically (`metadataProviders` in model-probe.ts). */
 ai:{assistantId:string|null; provider:string|null; secretName:string|null; keyInstalled:boolean; checkable:boolean}
 /** The provisioned starter assistant (`starter_ai`), while it exists. `edited` once it differs from what it was created with. */
 starterAssistant:{id:string; name:string; model:string; provider:string|null; edited:boolean}|null
 inboundAddress:string|null
 /** `gateway` says the installation holds INBOUND_EMAIL_TOKEN (presence only); workers.dev cannot receive mail. */
 inbound:{enabled:boolean; gateway:boolean; customDomainRequired:boolean; receiving:Receiving['reason']}
 /** Null when AI_DAILY_CEILINGS is invalid. */
 ceilings:{repliesPerProject:number; repliesPerInstallation:number; spendUsdPerProject:number; contextRunsPerProject:number; resetUtc:'00:00'; source:'defaults'|'installation'}|null
 /** From the last sender_dns observation still valid for the current configuration (Resend domain detail). */
 senderRecords:SenderRecord[]
 widget:{key:string; scriptUrl:string; apiOrigin:string}
}

/** `GET /api/management/projects/:id/activation` and every `POST .../check` / `.../test-mail` / `.../skip` response (`{data}`). */
export type ActivationSnapshot = {
 projectId:string
 total:8
 /** Applicable steps observed `done`: always at most `applicableTotal`. */
 done:number
 /** Steps that can be confirmed on this installation and that the owner has not skipped (the "M" in "N of M confirmed"). */
 applicableTotal:number
 environment:Environment
 /** The latest observation time across steps (ISO, UTC), or null before any check. */
 checkedAt:string|null
 steps:ActivationStep[]
 facts:ActivationFacts
}

/** `POST .../skip` body (strict: no other keys). Only `skippable` steps; the answer is the snapshot. */
export type SkipRequest = {step:StepId; skipped:boolean}

/** `POST .../check` body. `auto` applies the freshness windows; without it the check runs now (behind the 60 s lease). */
export type CheckRequest = {step?:StepId; auto?:true}
