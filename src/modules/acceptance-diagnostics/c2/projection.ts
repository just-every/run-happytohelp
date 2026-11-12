/** Only exact native categories are recognized. Unknown text never becomes a successful outcome. */
export function errorCategory(column:string){
 return `CASE WHEN ${column} IS NULL OR ${column}='' THEN 'none'
 WHEN ${column} IN ('Knowledge access changed; edit and resend for the current recipients','Error: knowledge_access_denied') THEN 'policy_refusal'
 WHEN ${column} IN ('Email provider rate limited delivery','Error: KNOWLEDGE_INDEX_NOT_READY','HTTPException: Inbound email is already processing; retry later') THEN 'busy'
 WHEN ${column} IN ('Email provider rejected delivery','Recipient permanently rejected') THEN 'provider_refusal'
 WHEN ${column} IN ('Email delivery outcome unknown; reconcile before retrying','Delivery outcome unknown') THEN 'provider_uncertain'
 ELSE 'unknown' END`
}
export function receiptState(column:string){return `CASE WHEN ${column} IN ('processing','delivered','failed','ignored','suspended','expired','erased') THEN ${column} ELSE 'unknown' END`}
export function deliveryState(column:string){return `CASE WHEN ${column} IN ('sending','sent','failed','uncertain') THEN ${column} ELSE 'unknown' END`}
