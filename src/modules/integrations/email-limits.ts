/** Receiving limits apply before ticket admission and again on public recovery.
 * Suspended custody retains all files even when normal mail cannot admit them. */
export const MAX_INBOUND_RAW_BYTES=25000000
export const MAX_INBOUND_ATTACHMENT_BYTES=20000000
export const MAX_INBOUND_ATTACHMENTS=20
export function inboundAttachmentsOverLimit(sizes:readonly number[]){
 return sizes.length>MAX_INBOUND_ATTACHMENTS||sizes.some(size=>size>MAX_INBOUND_ATTACHMENT_BYTES)
}
