import type {Env} from '../../platform/env'
export const agreements=['dpa','baa'] as const
export const controls=['tenant_isolation','permissions','audit','retention','recovery','erasure','export','incident_response','channel_consent'] as const
export const kinds=[...agreements,'subprocessor',...controls] as const
export type EvidenceKind=typeof kinds[number]
export interface Profile {project_id:string;partner:string;deployment_ref:string;timezone:string;country:string;currency:string;recording_enabled:number;revision:number;requested_at:number}
export interface Evidence {id:string;project_id:string;kind:EvidenceKind;provider:string;reference:string;status:string;settings_json:string;valid_from:number;expires_at:number;revoked_at:number|null;recorded_at:number;recorded_by:string}
export async function qualification(env:Env,projectId:string,now=Date.now()){
 const profile=await env.DB.prepare('SELECT * FROM assurance_profiles WHERE project_id=?').bind(projectId).first<Profile>()
 const evidence=(await env.DB.prepare('SELECT * FROM assurance_evidence WHERE project_id=? ORDER BY recorded_at,id').bind(projectId).all<Evidence>()).results
 const valid=(kind:string,status:string)=>evidence.filter(row=>row.kind===kind&&row.status===status&&!row.revoked_at&&row.valid_from<=now&&row.expires_at>now)
 const blockers:string[]=[]
 if(!profile)blockers.push('Record the isolated deployment, qualification partner and IANA calendar.')
 for(const kind of agreements)if(!valid(kind,'executed').length)blockers.push(`Required executed ${kind.toUpperCase()} is missing, expired or revoked.`)
 const providers=valid('subprocessor','approved')
 if(!providers.length)blockers.push('Record approved US subprocessors and model-data handling settings.')
 for(const provider of providers){const settings=JSON.parse(provider.settings_json);if(settings.region!=='US'||settings.model_training!==false||!Number.isInteger(settings.retention_days)||settings.retention_days<0||settings.baa_covered!==true)blockers.push(`Provider ${provider.provider} needs US region, no model training, explicit retention and BAA coverage.`)}
 for(const kind of controls)if(!valid(kind,'passed').length)blockers.push(`Technical acceptance ${kind.replaceAll('_',' ')} needs a current passing deployment receipt.`)
 const audit=await env.DB.prepare('SELECT json_extract(settings_json,\'$.audit_retention_days\') days FROM project_settings WHERE project_id=?').bind(projectId).first<{days:number|null}>()
 if(!audit?.days||audit.days<90||audit.days>3650)blockers.push('Configure native security-log retention (90–3650 days); legal holds continue to protect evidence.')
 // Records and self-attestation are readiness evidence, never independent regulated-deployment qualification.
 // No cloud builder or ordinary product setting may manufacture the missing partner acceptance.
 const activationBlocker='Health-data activation is held for independent partner review of executed agreements and representative sensitive-data deployment acceptance. Self-hosting and recorded receipts alone do not qualify this deployment.'
 return {profile,evidence,readiness:!blockers.length?'ready_for_independent_review':'incomplete',blockers,health_data_enabled:false,recording_enabled:false,activation_blocker:activationBlocker,country:'US',currency:'USD',evaluated_at:now}
}
