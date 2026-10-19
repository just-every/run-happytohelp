import type {PortalIdentity} from './identity'

/** Internal admission authority; it cannot be supplied through JSON or a widget session. */
export const companyPortalReply=Symbol('companyPortalReply')

/** Company access always follows current membership and the operator's explicit entitlement. */
export function portalTicketScope(identity:PortalIdentity,alias='c'){
 const id=identity.actor.contactId||identity.actor.id
 return {sql:`(${alias}.contact_id=? OR EXISTS(SELECT 1 FROM contact_companies mine JOIN companies account ON account.id=mine.company_id AND account.project_id=mine.project_id JOIN contact_companies requester ON requester.company_id=account.id AND requester.project_id=account.project_id JOIN contacts customer ON customer.id=requester.contact_id AND customer.project_id=requester.project_id WHERE mine.project_id=${alias}.project_id AND mine.contact_id=? AND requester.contact_id=${alias}.contact_id AND account.portal_company_view=1 AND account.merged_into IS NULL AND coalesce(json_extract(customer.metadata_json,'$.is_erased'),0)!=1 AND coalesce(json_extract(customer.metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(customer.metadata_json,'$.is_deleted'),0)!=1 AND NOT EXISTS(SELECT 1 FROM contact_erasures erased WHERE erased.project_id=customer.project_id AND erased.contact_id=customer.id)))`,args:[id,id]}
}

export async function portalCompanyName(db:D1Database,identity:PortalIdentity){
 return (await db.prepare('SELECT account.name FROM contact_companies member JOIN companies account ON account.id=member.company_id AND account.project_id=member.project_id WHERE member.project_id=? AND member.contact_id=? AND account.portal_company_view=1 AND account.merged_into IS NULL').bind(identity.actor.projectId,identity.actor.id).first<{name:string}>())?.name
}
