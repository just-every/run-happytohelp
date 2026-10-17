export type NotificationContact={id:string;email:string|null;metadata_json?:string}
const mailbox=(value:unknown)=>typeof value==='string'&&value.length<=254&&/^[^\s@<>(),:;"\\]+@[^\s@<>(),:;"\\]+\.[^\s@<>(),:;"\\]+$/.test(value.trim())?value.trim().toLowerCase():null
const metadata=(contact:NotificationContact)=>JSON.parse(contact.metadata_json||'{}')

/** A collected preference chooses only a notification destination. It never
 * changes canonical identity, verification, participants or inbound authority.
 * Mail with no usable From names nobody to answer: its contact is notified only at
 * an address an operator chose for it. */
export function notificationAddress(contact:NotificationContact){const flags=metadata(contact);return mailbox(flags.provided_email)||(flags.unusable_from?null:mailbox(contact.email))}

/** Sending and read-only status use the same address, safety and author exclusions. */
export function notificationRecipients(contacts:NotificationContact[],sender:NotificationContact|undefined,senderContactId?:string){
 const senderEmails=new Set<string>()
 if(sender)for(const value of [sender.email,metadata(sender).provided_email]){const email=mailbox(value);if(email)senderEmails.add(email)}
 const excluded=new Set(senderEmails)
 const recipients:{id:string;email:string}[]=[]
 let senderAddress=false
 for(const contact of contacts){
  const flags=metadata(contact)
  if(contact.id===senderContactId||flags.is_erasing||flags.is_erased||flags.is_deleted||flags.is_blocked||flags.portal_notification_emails===0)continue
  const email=notificationAddress(contact)
  if(email&&senderEmails.has(email))senderAddress=true
  if(email&&!excluded.has(email)){recipients.push({id:contact.id,email});excluded.add(email)}
 }
 return {recipients,state:recipients.length?'not_recorded':senderAddress?'sender_address':'no_recipient'}
}
