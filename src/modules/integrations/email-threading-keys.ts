/** Thread identifiers locate candidates only. They never authenticate a sender. */
export type ThreadKeyKind='message_id'|'subject_token'|'reply_address'|'vendor_header'
export interface ThreadKey {kind:ThreadKeyKind;value:string;source:string;sourceRef:string}
export const vendorThreadHeaders:Readonly<Record<string,string>>={
 'x-zendesk-ticket-id':'zendesk','x-freshdesk-ticket-id':'freshdesk',
 'x-hs-conversation-id':'helpscout','x-helpscout-conversation-id':'helpscout',
 'x-intercom-conversation-id':'intercom','x-intercom-conversation':'intercom'
}
export function messageIds(value:unknown):string[]{
 if(typeof value!=='string'||value.length>16384||/[\r\n\0]/.test(value))return []
 const matches=value.match(/<[^<>\s]+@[^<>\s]+>/g)??(value.trim().match(/^[^<>\s]+@[^<>\s]+$/)?[value.trim()]:[])
 return [...new Set(matches.slice(0,100).map(raw=>{const bare=raw.replace(/^<|>$/g,''),at=bare.lastIndexOf('@');return `<${bare.slice(0,at)}@${bare.slice(at+1).toLowerCase()}>`}))]
}
export function threadAddresses(value:unknown):string[]{
 if(Array.isArray(value))return [...new Set(value.slice(0,100).flatMap(threadAddresses))]
 if(value&&typeof value==='object')return threadAddresses((value as any).email??(value as any).address)
 if(typeof value!=='string'||value.length>16384||/[\r\n\0]/.test(value))return []
 return [...new Set((value.match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)??[]).slice(0,100).map(s=>s.toLowerCase()))]
}
export function subjectThreadKeys(value:unknown):{kind:ThreadKeyKind;value:string;source:string}[]{
 if(typeof value!=='string'||value.length>16384||/[\r\n\0]/.test(value))return []
 const keys:{kind:ThreadKeyKind;value:string;source:string}[]=[]
 for(const match of value.matchAll(/\[H2H:([A-Za-z0-9_-]{1,200})\]/gi))keys.push({kind:'subject_token',value:`h2h:${match[1]}`,source:'native'})
 for(const match of value.matchAll(/\[([A-Za-z0-9]{4}-[A-Za-z0-9]{4})\]/g))keys.push({kind:'subject_token',value:`zendesk:${match[1].toUpperCase()}`,source:'zendesk'})
 for(const match of value.matchAll(/\[(?:Ticket|Request)\s+#([1-9][0-9]{0,19})\]/gi))keys.push({kind:'subject_token',value:`zendesk:ticket:${match[1]}`,source:'zendesk'})
 for(const match of value.matchAll(/\[#([1-9][0-9]{0,19})\]/g)){
  keys.push({kind:'subject_token',value:`freshdesk:${match[1]}`,source:'freshdesk'})
  keys.push({kind:'subject_token',value:`helpscout:number:${match[1]}`,source:'helpscout'})
 }
 return keys.slice(0,100)
}
export function headerEntries(value:unknown):[string,string][]{
 if(Array.isArray(value))return value.slice(0,100).flatMap(item=>item&&typeof item==='object'&&typeof item.name==='string'&&typeof item.value==='string'?[[item.name.toLowerCase(),item.value] as [string,string]]:[])
 if(!value||typeof value!=='object')return []
 return Object.entries(value).slice(0,100).flatMap(([name,raw])=>typeof raw==='string'?[[name.toLowerCase(),raw] as [string,string]]:[])
}
export function headerThreadKeys(headers:unknown,source:string,sourceRef:string):ThreadKey[]{
 const result:ThreadKey[]=[]
 for(const [name,value] of headerEntries(headers)){
  if(['message-id','in-reply-to','references'].includes(name))for(const id of messageIds(value))result.push({kind:'message_id',value:id,source,sourceRef:`${sourceRef}/${name}`})
  if(name==='reply-to')for(const address of threadAddresses(value))result.push({kind:'reply_address',value:address,source,sourceRef:`${sourceRef}/${name}`})
  if(vendorThreadHeaders[name]&&value.length<=200&&!/[\r\n\0]/.test(value)&&value.trim())result.push({kind:'vendor_header',value:`${name}:${value.trim()}`,source,sourceRef:`${sourceRef}/${name}`})
 }
 return result
}
export function nativeThreadSubject(subject:string,conversationId:string){
 if(!/^[A-Za-z0-9_-]{1,200}$/.test(conversationId)||/[\r\n\0]/.test(subject))throw new Error('Invalid email thread subject')
 return `${subject.replace(/\s*\[H2H:[A-Za-z0-9_-]{1,200}\]/gi,'').trim()} [H2H:${conversationId}]`.trim()
}
