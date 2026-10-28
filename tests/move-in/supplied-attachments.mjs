import {createHash} from 'node:crypto'
import {contact,agent,ticket} from './freshdesk-fixtures.mjs'
export const publicBytes=Buffer.from('synthetic-hh-1 public receipt\n')
export const privateBytes=Buffer.from('synthetic-hh-2 private triage\n')
export const attachment=(id,name,bytes)=>({id,name,content_type:'text/plain',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')})
export function suppliedFreshdesk(id=5001){const t=ticket(id);t.ticket.attachments=[attachment(80,'public-receipt.txt',publicBytes)];t.ticket.conversations[0].attachments=[attachment(81,'private-triage.txt',privateBytes)];return [structuredClone(contact),structuredClone(agent),t]}
