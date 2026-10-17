import {emailAddress} from './inbound-routing'

/**
 * Automatic-mail classification. HappyToHelp replies on its own, so an
 * out-of-office notice, a bounce or list mail that reaches a conversation must
 * never earn an AI reply, an operator notification or an outbound email: each
 * of those would answer a machine and could start a reply loop.
 *
 * Every ingress keeps a bounded copy of the evidence the message carried (the
 * envelope sender, the header From, the subject and a fixed set of headers).
 * The classifier reads only that evidence and names every rule that matched.
 */

// Headers the classifier reads come first; the trailing threading headers are
// retained for inspection only and are the first dropped from stored evidence.
export const EVIDENCE_HEADERS=['auto-submitted','precedence','x-auto-response-suppress','list-id','list-unsubscribe','x-autoreply','x-autorespond','return-path','authentication-results','received-spf','x-spam-flag','x-spam-score','x-zendesk-ticket-id','x-freshdesk-ticket-id','x-hs-conversation-id','x-helpscout-conversation-id','x-intercom-conversation-id','x-intercom-conversation','reply-to','message-id','in-reply-to','references'] as const
export type EvidenceHeader=typeof EVIDENCE_HEADERS[number]
/** `sender_verified` records whether the ingress verified the header From (DKIM, DMARC
 * or aligned SPF); the envelope sender is delivery metadata, never identity. */
export interface EmailEvidence {envelope_from:string;header_from:string|null;subject:string|null;headers:Partial<Record<EvidenceHeader,string>>;sender_verified?:boolean;grant?:{recipient:string;token_hash:string}}
export interface EmailClassification {automatic:boolean;reasons:string[]}
export type HeaderEntry={key:unknown;value:unknown}

const retained=new Set<string>(EVIDENCE_HEADERS)
// Control characters never reach stored evidence, so JSON escaping can at most
// double a value and the stored bound below always holds.
const bounded=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,max):null

/** Evidence from header entries in receipt order; the first occurrence of a header wins. */
export function emailEvidence(input:{envelopeFrom:unknown;headerFrom:unknown;subject:unknown;headers:Iterable<HeaderEntry|null|undefined>}):EmailEvidence{
 const headers:EmailEvidence['headers']={}
 for(const header of input.headers){
  if(!header||typeof header.key!=='string')continue
  const key=header.key.trim().toLowerCase(),value=bounded(header.value,200)
  if(retained.has(key)&&value!==null&&!(key in headers))headers[key as EvidenceHeader]=value
 }
 return {envelope_from:bounded(input.envelopeFrom,320)||'',header_from:bounded(input.headerFrom,320),subject:bounded(input.subject,200),headers}
}

/** A raw header block (SendGrid Inbound Parse `headers`), with folded lines joined. */
export function headerBlockEntries(block:string):HeaderEntry[]{
 const entries:{key:string;value:string}[]=[]
 for(const line of block.slice(0,65536).split(/\r?\n/)){
  if(/^[ \t]/.test(line)){const last=entries.at(-1);if(last)last.value=`${last.value} ${line.trim()}`;continue}
  const separator=line.indexOf(':')
  if(separator>0)entries.push({key:line.slice(0,separator),value:line.slice(separator+1)})
 }
 return entries
}

/** The JSON gateway supplies headers as an object of name to string value. */
export function gatewayHeaderEntries(value:unknown):HeaderEntry[]{
 return value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value).map(([key,entry])=>({key,value:entry})):[]
}

/** Autoresponders prefix the original subject; customers write the same words inline. */
export const AUTOMATIC_SUBJECT=/^\s*(?:(?:re|fwd?|aw|wg)\s*:\s*)*(?:automatic reply|auto-?reply|out of (?:the )?office|undeliverable|delivery status(?: notification)?|delivery failure|mail delivery failed|returned mail)\s*(?:[:\-–—(\[]|$)/i

function senderReasons(value:string|null,reasons:Set<string>){
 const address=value?emailAddress(value)||value.trim().toLowerCase():''
 const local=address.split('@',1)[0]||''
 if(/^(?:mailer-daemon|postmaster)$/.test(local))reasons.add('mailer-daemon')
 if(/no[-_.]?reply|do[-_.]?not[-_.]?reply/.test(local))reasons.add('no-reply')
}

export function classifyInboundEmail(evidence:EmailEvidence):EmailClassification{
 const reasons=new Set<string>(),header=(name:EvidenceHeader)=>evidence.headers[name]?.trim().toLowerCase()
 const autoSubmitted=header('auto-submitted'),suppress=header('x-auto-response-suppress'),autoreply=header('x-autoreply')??header('x-autorespond')
 if(autoSubmitted!==undefined&&autoSubmitted!=='no')reasons.add('auto-submitted')
 if(/(?:^|\s)(?:bulk|list|junk|auto_reply)(?:\s|$)/.test(header('precedence')??''))reasons.add('precedence')
 if(suppress!==undefined&&suppress!=='none')reasons.add('x-auto-response-suppress')
 if(header('list-id')!==undefined)reasons.add('list-id')
 if(header('list-unsubscribe')!==undefined)reasons.add('list-unsubscribe')
 if(autoreply!==undefined&&autoreply!=='no')reasons.add('x-autoreply')
 senderReasons(evidence.envelope_from,reasons)
 senderReasons(evidence.header_from,reasons)
 if(evidence.subject!==null&&AUTOMATIC_SUBJECT.test(evidence.subject))reasons.add('subject')
 // A null return path (`MAIL FROM:<>`) is how delivery reports and RFC 3834 auto-replies arrive.
 if(evidence.envelope_from===''||evidence.envelope_from==='<>'||header('return-path')==='<>')reasons.add('null-sender')
 return {automatic:reasons.size>0,reasons:[...reasons]}
}

export const MAX_EVIDENCE_JSON=4000
/** Stored beside the claim. Oversized evidence loses retained headers from the end
 * of EVIDENCE_HEADERS (threading first), so what the classifier read survives longest. */
export function evidenceJson(evidence:EmailEvidence,classification:EmailClassification):string{
 const headers={...evidence.headers},serialize=()=>JSON.stringify({...evidence,headers,reasons:classification.reasons})
 let stored=serialize()
 for(let index=EVIDENCE_HEADERS.length-1;stored.length>MAX_EVIDENCE_JSON&&index>=0;index--){delete headers[EVIDENCE_HEADERS[index]];stored=serialize()}
 return stored
}
