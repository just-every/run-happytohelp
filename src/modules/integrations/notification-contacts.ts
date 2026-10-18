import {provenAddressSql} from './inbound-authority'
import {noticeParticipantSql} from './participant-proof'
import {consumedReplyGrantSql} from './notice-address-proof'

/** Shared by automatic notices and message relays. Merely naming a Cc address
 * does not prove it; an explicit operator preference proves only that preference. */
export const noticeParticipantProofSql=(ct:string,cp:string)=>`(((${provenAddressSql(ct)} OR ${consumedReplyGrantSql(ct,`${cp}.conversation_id`)}) AND ${noticeParticipantSql(ct,cp)})
 OR (json_extract(${ct}.metadata_json,'$.provided_email_source')='operator' AND nullif(trim(json_extract(${ct}.metadata_json,'$.provided_email')),'') IS NOT NULL))`

/** All current recipients, with automatic eligibility kept separate so a human
 * reply can still address every participant at their collected preference. */
export const notificationContactsSql=`SELECT ct.*,c.id conversation_id,c.project_id notification_project_id,
 CASE WHEN c.channel='widget' THEN c.contact_id END widget_contact_id,
 ${consumedReplyGrantSql('ct','c.id')} notice_grant_proven,
 (ct.id=c.contact_id OR (coalesce(json_extract(ct.metadata_json,'$.unverified_sender'),0)!=1
 AND EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=c.id AND cp.contact_id=ct.id AND ${noticeParticipantProofSql('ct','cp')}))) notice_eligible
 FROM conversations c JOIN contacts ct ON ct.project_id=c.project_id
 AND (ct.id=c.contact_id OR EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=c.id AND cp.contact_id=ct.id))`
