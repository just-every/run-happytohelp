const mailboxPattern=/^([^@\s]+)@([^@\s]+)$/
const addressPattern=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const conversationPattern=/^[A-Za-z0-9_-]{1,200}$/

export function emailAddress(value:unknown):string|null{
 if(typeof value!=='string'||/[\r\n\0]/.test(value))return null
 const text=value.trim(),angle=text.match(/<([^<>]+)>$/),address=(angle?.[1]||text).trim().toLowerCase()
 return addressPattern.test(address)?address:null
}
export function mailbox(value:unknown):string|null{
 const address=emailAddress(value),match=address?.match(mailboxPattern)
 return match?`${match[1]}@${match[2]}`:null
}
export function inboundTarget(value:unknown):{mailbox:string;conversationId:string|null;replyToken?:string}|null{
 const address=emailAddress(value),match=address?.match(/^([^@\s]+)@([^@\s]+)$/)
 if(!match)return null
 const plus=match[1].lastIndexOf('+')
 if(plus<1){const base=mailbox(address);return base?{mailbox:base,conversationId:null}:null}
 const local=match[1].slice(0,plus),conversationId=match[1].slice(plus+1)
 if(/^r\.[a-f0-9]{32}$/.test(conversationId)&&mailbox(`${local}@${match[2]}`))return {mailbox:`${local}@${match[2]}`,conversationId:null,replyToken:conversationId.slice(2)}
 if(!conversationPattern.test(conversationId)||!mailbox(`${local}@${match[2]}`))return null
 return {mailbox:`${local}@${match[2]}`,conversationId}
}
export function replyAddress(value:unknown,conversationId:string):string|null{
 const base=mailbox(value)
 return base&&conversationPattern.test(conversationId)?`${base.slice(0,base.indexOf('@'))}+${conversationId}@${base.slice(base.indexOf('@')+1)}`:null
}
