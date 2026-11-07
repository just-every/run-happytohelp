import {headerBlockEntries} from '../email-classification'
import {emailAddress,inboundTarget} from '../inbound-routing'
import type {LegacyMailS3Config} from './config'

/** The header block of a message: the bytes up to the first blank line, unfolded, names lower-cased. The first
 * entries are the ones Amazon SES wrote on top; everything below was written by the sender or an earlier hop. */
export type HeaderLine={key:string;value:string}
export function headerLines(raw:Uint8Array):HeaderLine[]{
 const block=new TextDecoder('latin1').decode(raw.subarray(0,65536)).split(/\r?\n\r?\n/,1)[0]
 return headerBlockEntries(block).flatMap(entry=>typeof entry.key==='string'&&typeof entry.value==='string'?[{key:entry.key.trim().toLowerCase(),value:entry.value.trim().replace(/\s+/g,' ')}]:[])
}
/** The SMTP sender SES recorded, from the top `Return-Path`. */
export const returnPath=(lines:readonly HeaderLine[])=>emailAddress(lines.find(line=>line.key==='return-path')?.value)
const RECEIVED_TAIL=/\sby\s+inbound-smtp\.([a-z0-9-]+)\.amazonaws\.com\s+with\s+\S+\s+id\s+\S+\s+for\s+(\S+)$/i
/** The address SES received the message for, taken only from the first `Received` header, only when it names SES
 * receiving in this region and carries a `for` clause (SES writes `for address;`; RFC 5321 also allows `for <address>;`).
 * The clause is read from the end of the line, where SES wrote it, so words a sender put in the HELO or reverse name
 * earlier in the line never stand for it. Never `To:`, `Cc:` or a lower `Received`. */
export function envelopeRecipient(lines:readonly HeaderLine[],region:string):string|null{
 const first=lines.find(line=>line.key==='received')
 if(!first)return null
 const end=first.value.lastIndexOf(';')
 if(end<0||first.value.slice(end+1).includes(';'))return null
 const match=first.value.slice(0,end).match(RECEIVED_TAIL)
 if(!match||match[1].toLowerCase()!==region.toLowerCase())return null
 return emailAddress(match[2].replace(/^<(.*)>$/,'$1'))
}
export interface BoundRecipient {address:string;conversationId:string|null;replyToken:string|null}
/** The envelope recipient when it is the configured mailbox or one of its `+label` forms; otherwise null. */
export function boundRecipient(lines:readonly HeaderLine[],config:LegacyMailS3Config):BoundRecipient|null{
 const address=envelopeRecipient(lines,config.region),target=address?inboundTarget(address):null
 return address&&target&&target.mailbox===config.mailbox?{address,conversationId:target.conversationId,replyToken:target.replyToken??null}:null
}
