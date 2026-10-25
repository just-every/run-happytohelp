/** One predicate over current ticket placement and immutable API origin. */
export function reachPredicate(credential='bound',row='c',origin='origin'){
 const dimensions={brands:`coalesce(${row}.brand_id,${row}.project_id)`,mailboxes:`${row}.mailbox_id`,groups:`${row}.group_id`,forms:`${origin}.form_id`}
 return `(${credential}.source_product IS NULL OR ((${origin}.credential_id=${credential}.id OR ${origin}.credential_id IN (SELECT value FROM json_each(${credential}.reach_json,'$.credentials'))) AND ${Object.entries(dimensions).map(([key,value])=>`(json_type(${credential}.reach_json,'$.${key}') IS NULL OR ${value} IN (SELECT value FROM json_each(${credential}.reach_json,'$.${key}')))` ).join(' AND ')}))`
}
export const conversationReach=(credential='?',conversation='c')=>`EXISTS(SELECT 1 FROM api_credentials bound LEFT JOIN api_conversations origin ON origin.conversation_id=${conversation}.id AND origin.project_id=bound.namespace WHERE bound.namespace=${conversation}.project_id AND bound.id=${credential} AND ${reachPredicate('bound',conversation)})`
export function plannedReach(project:string,credential:string,plan:any){
 return {sql:`SELECT 1 FROM api_credentials bound JOIN (SELECT ? project_id,? brand_id,? mailbox_id,? group_id) c JOIN (SELECT ? credential_id,? form_id) origin WHERE bound.namespace=c.project_id AND bound.id=origin.credential_id AND ${reachPredicate()}`,params:[project,plan.brand_id??null,plan.mailbox_id??null,plan.group_id??null,credential,plan.form_id??null]}
}
