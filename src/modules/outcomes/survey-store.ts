import type {Env} from '../../platform/env'
import {provenAddressSql} from '../integrations/inbound-authority'
export type SurveyScale='thumbs'|'five'
export type SurveyLocale='en'|'es'|'fr'
export interface SurveySettings {enabled:boolean;widgetEnabled:boolean;scale:SurveyScale;delayMinutes:number;expiresDays:number;locale:SurveyLocale}
export const defaultSurveySettings:SurveySettings={enabled:false,widgetEnabled:true,scale:'thumbs',delayMinutes:0,expiresDays:14,locale:'en'}
export async function readSurveySettings(env:Env,projectId:string):Promise<SurveySettings>{
 const row=await env.DB.prepare("SELECT s.*,COALESCE(json_extract(p.settings_json,'$.csat_widget_enabled'),1) widget_enabled FROM (SELECT ? project_id) selected LEFT JOIN csat_settings s ON s.project_id=selected.project_id LEFT JOIN project_settings p ON p.project_id=selected.project_id").bind(projectId).first<any>()
 return {...defaultSurveySettings,...(row?.scale?{enabled:row.enabled===1,scale:row.scale,delayMinutes:row.delay_minutes,expiresDays:row.expires_days,locale:row.locale}:{}),widgetEnabled:row?.widget_enabled!==0}
}
export interface Survey {id:string;project_id:string;resolution_id:string;conversation_id:string;contact_id:string;recipient:string;channel:string;scale:SurveyScale;locale:SurveyLocale;due_at:number;expires_at:number;state:string;token_revision:number;revoked_at:number|null;created_at:number;updated_at:number}
/** Shared by scheduling, sending and response commit; c,r,ct are scoped joins. */
export const isSolvedSql=(alias='c')=>`${alias}.status_category IN ('solved','closed') AND ${alias}.resolved_at IS NOT NULL`
export const liveCycleSql=`r.reopened_at IS NULL AND ${isSolvedSql()} AND c.contact_id=r.contact_id AND ct.id=r.contact_id AND ct.project_id=r.project_id
 AND r.ordinal=(SELECT MAX(latest.ordinal) FROM conversation_resolutions latest WHERE latest.conversation_id=c.id)
 AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1
 AND COALESCE(json_extract(ct.metadata_json,'$.is_deleted'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`
/** Never turn retained imports, typed widget addresses or machine mail into survey authority.
 * A native inbound receipt must identify a real human message in this exact cycle,
 * or a signed widget identity must name this precise mailbox. */
const portalMailboxProof=`EXISTS(SELECT 1 FROM portal_identities pi WHERE pi.project_id=ct.project_id AND pi.contact_id=ct.id AND pi.email=lower(trim(ct.email)))`
export const surveyRecipientSql=`(${provenAddressSql('ct')} OR ${portalMailboxProof})
 AND COALESCE(json_extract(ct.metadata_json,'$.unverified_sender'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.unusable_from'),0)!=1
 AND NOT EXISTS(SELECT 1 FROM move_in_conversations mi WHERE mi.conversation_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM reporting_legacy_conversations legacy WHERE legacy.conversation_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM legacy_import_rows li WHERE li.target_table='conversations' AND li.target_key=c.id)
 AND NOT EXISTS(SELECT 1 FROM ik_provenance ip WHERE ip.target_kind='conversation' AND ip.target_id=c.id AND ip.reversed=0)
 AND EXISTS(
 SELECT 1 FROM messages m JOIN message_authorship ma ON ma.message_id=m.id LEFT JOIN inbound_emails ie ON ie.project_id=m.project_id AND ie.local_id=m.local_id
 WHERE m.conversation_id=c.id AND m.project_id=c.project_id AND m.actor_role='contact' AND m.actor_id=ct.id
 AND m.revision>r.cycle_start_revision AND m.revision<=r.resolved_revision AND ma.kind='visitor'
 AND (ie.id IS NULL AND m.local_id NOT LIKE 'email:%' AND ct.is_verified=1 AND (lower(ct.external_id)=lower(ct.email) OR ${portalMailboxProof})
 OR ie.automatic=0 AND (ie.message_id=m.id OR ie.message_id IS NULL AND ie.conversation_id=c.id)
 AND json_extract(ie.evidence_json,'$.sender_verified')=1
 AND lower(trim(CASE WHEN instr(json_extract(ie.evidence_json,'$.header_from'),'<')>0
 THEN substr(json_extract(ie.evidence_json,'$.header_from'),instr(json_extract(ie.evidence_json,'$.header_from'),'<')+1,instr(json_extract(ie.evidence_json,'$.header_from'),'>')-instr(json_extract(ie.evidence_json,'$.header_from'),'<')-1)
 ELSE json_extract(ie.evidence_json,'$.header_from') END))=lower(trim(ct.email))))
 AND NOT EXISTS(SELECT 1 FROM csat_optouts o WHERE o.project_id=r.project_id AND o.contact_id=r.contact_id)`
export const surveyJoins=`FROM csat_surveys s JOIN conversation_resolutions r ON r.id=s.resolution_id AND r.project_id=s.project_id JOIN conversations c ON c.id=r.conversation_id AND c.project_id=r.project_id JOIN contacts ct ON ct.id=r.contact_id AND ct.project_id=r.project_id`
export const activeSurveySql=`${liveCycleSql} AND s.revoked_at IS NULL AND s.expires_at>? AND NOT EXISTS(SELECT 1 FROM csat_optouts o WHERE o.project_id=s.project_id AND o.contact_id=s.contact_id)`
/** Root erasure runner batches these with its existing contact erasure statements. */
export function eraseSurveyStatements(env:Env,projectId:string,contactId:string){return [
 env.DB.prepare("UPDATE csat_surveys SET recipient='',revoked_at=?,state=CASE WHEN state='pending' THEN 'cancelled' ELSE state END,updated_at=? WHERE project_id=? AND contact_id=?").bind(Date.now(),Date.now(),projectId,contactId),
 env.DB.prepare("UPDATE csat_responses SET comment='',reason='',recovery='unknown' WHERE project_id=? AND contact_id=?").bind(projectId,contactId),
 env.DB.prepare("UPDATE csat_response_history SET comment='',reason='',recovery='unknown' WHERE project_id=? AND contact_id=?").bind(projectId,contactId),
 env.DB.prepare('DELETE FROM csat_optouts WHERE project_id=? AND contact_id=?').bind(projectId,contactId)
]}
