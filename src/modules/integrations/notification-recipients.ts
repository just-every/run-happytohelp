import {mailboxAddress} from '../../platform/mailbox'
export type NotificationContact={id:string;email:string|null;metadata_json?:string;is_verified?:number;external_id?:string|null;notice_grant_proven?:number}
const mailbox=(value:unknown)=>typeof value==='string'&&value.length<=254&&/^[^\s@<>(),:;"\\]+@[^\s@<>(),:;"\\]+\.[^\s@<>(),:;"\\]+$/.test(value.trim())?value.trim().toLowerCase():null
const metadata=(contact:NotificationContact)=>JSON.parse(contact.metadata_json||'{}')

/** Reply delivery honours a collected preference. Automatic ticket notices use
 * customerNoticeAddress instead. Neither changes canonical identity or authority.
 * Mail with no usable From names nobody to answer: its contact is notified only at
 * an address an operator chose for it. */
export function notificationAddress(contact:NotificationContact){const flags=metadata(contact);return mailbox(flags.provided_email)||(flags.unusable_from?null:mailbox(contact.email))}

/** Automatic ticket notices cannot inherit an unproven reply preference. A signed
 * widget identity proves its canonical address, even after it types a preference.
 * K3 also allows the widget's own canonical address on its own widget ticket. Old
 * preferences with no recorded source stay available for human replies only. */
export function customerNoticeAddress(contact:NotificationContact,widgetContactId?:string){
 const flags=metadata(contact)
 if(flags.provided_email_source==='operator')return mailboxAddress(flags.provided_email)
 const signed=contact.is_verified===1&&mailbox(contact.external_id)===mailbox(contact.email)
 return flags.unusable_from||flags.email_unproven&&!signed&&!contact.notice_grant_proven&&contact.id!==widgetContactId?null:mailbox(contact.email)
}

/** Sending and read-only status use the same safety and author exclusions. */
export function notificationRecipients(contacts:NotificationContact[],sender:NotificationContact|undefined,senderContactId?:string,address=notificationAddress){
 const senderEmails=new Set<string>()
 if(sender)for(const value of [sender.email,metadata(sender).provided_email]){const email=mailbox(value);if(email)senderEmails.add(email)}
 const excluded=new Set(senderEmails)
 const recipients:{id:string;email:string}[]=[]
 let senderAddress=false
 for(const contact of contacts){
  const flags=metadata(contact)
  if(contact.id===senderContactId||flags.is_erasing||flags.is_erased||flags.is_deleted||flags.is_blocked)continue
  const email=address(contact)
  if(email&&senderEmails.has(email))senderAddress=true
  if(email&&!excluded.has(email)){recipients.push({id:contact.id,email});excluded.add(email)}
 }
 return {recipients,state:recipients.length?'not_recorded':senderAddress?'sender_address':'no_recipient'}
}
