import type {Actor,Env} from '../../platform/env.ts'
import {portalMailboxSql,signedMailboxSql} from '../identity/mailbox'
import {id} from '../../platform/db.ts'
import {contactWritable} from '../../platform/contact-state.ts'
import {mayReplySql} from '../access/reply-sql'

// A Symbol cannot arrive in a public JSON message command. Admission rechecks the
// receipt and sender authority in the transaction that commits the message.
export const inboundAuthority=Symbol('authenticated inbound email')
/** `grant`: the hash of the reply address this sender holds for the addressed
 * conversation (issued to exactly this sender), when the mail arrived through it.
 * `authenticated`: the ingress verified the From address. */
export interface InboundAuthority {sender:string;receiptId:string;claimToken:string;raw:string;cc:string[];authenticated:boolean;grant?:string;mailboxId?:string;mailboxAddress?:string}
const availableAs=(alias:string)=>`${contactWritable.replaceAll('metadata_json',`${alias}.metadata_json`)} AND coalesce(json_extract(${alias}.metadata_json,'$.is_blocked'),0)!=1 AND coalesce(json_extract(${alias}.metadata_json,'$.is_deleted'),0)!=1`,available=availableAs('contacts')

/** A contact's address is proven, so mail from that address is theirs, when mail
 * this desk received created the contact, or a widget signature names exactly that
 * address, or a portal link proved that mailbox. An address a widget visitor typed (`email_unproven`, set by the widget) is
 * where notifications may go, never who mail is from: otherwise an anonymous visitor
 * who types a customer's address would read that customer's mail. */
const unproven=(alias:string)=>`coalesce(json_extract(${alias}.metadata_json,'$.email_unproven'),0)=1`
export const provenAddressSql=(alias:string)=>`(${signedMailboxSql(alias)} OR coalesce(${alias}.is_verified,0)!=1 AND NOT ${unproven(alias)} OR ${portalMailboxSql(alias)})`

// A contact kept apart for mail whose From could not be authenticated (below).
const UNVERIFIED_SENDER="coalesce(json_extract(metadata_json,'$.unverified_sender'),0)=1"
const ownContact=`NOT ${UNVERIFIED_SENDER} AND ${provenAddressSql('contacts')}`

/** The project's contact for a sender address, created on first mail. Retained
 * history may hold two contacts with one address; the earliest keeps the mail, as
 * legacy did. A blocked, deleted or erased contact receives nothing (null). */
export async function emailContact(env:Env,projectId:string,email:string){
 return senderContact(env,projectId,email,ownContact,'{}')
}

async function senderContact(env:Env,projectId:string,email:string,kind:string,metadata:string){
 const read=()=>env.DB.prepare(`SELECT * FROM contacts WHERE project_id=? AND lower(email)=? AND ${kind} ORDER BY ${portalMailboxSql('contacts')} DESC,is_verified DESC,created_at,id LIMIT 1`).bind(projectId,email).first<any>()
 let contact=await read()
 if(!contact){
  await env.DB.prepare(`INSERT INTO contacts(id,project_id,email,metadata_json,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM contacts WHERE project_id=? AND lower(email)=? AND ${kind})`).bind(id(),projectId,email,metadata,Date.now(),projectId,email).run()
  contact=await read()
 }
 if(!contact||!await env.DB.prepare(`SELECT id FROM contacts WHERE id=? AND project_id=? AND ${available}`).bind(contact.id,projectId).first())return null
 return contact
}

/** The current participant or workspace member a sender address names in this
 * conversation, or null. Member authority needs `members`: an authenticated From
 * or possession of that member's reply address. A contact whose address is not
 * proven (typed into the widget, or a verified visitor's unsigned email) writes here
 * only through the reply address issued to it for this conversation (`granted`):
 * whoever reads that mailbox was sent this thread and is answering it. Fresh mail
 * from that address, or mail to another thread, goes to its own email contact. */
/** A member whose role cannot reply publicly (a collaborator, or a custom role without it) never writes to a thread by email. */
export async function emailActor(env:Env,projectId:string,conversation:any,sender:string,members:boolean,granted:boolean):Promise<Actor|null>{
 const people=members?(await env.DB.prepare(`SELECT u.id,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? AND lower(u.email)=? AND ${mayReplySql('m')} LIMIT 2`).bind(projectId,sender).all<{id:string;role:Actor['role']}>()).results:[]
 const contacts=(await env.DB.prepare(`SELECT ct.id FROM contacts ct WHERE ct.project_id=? AND lower(ct.email)=? AND ${granted?'1':provenAddressSql('ct')} AND ${availableAs('ct')} AND (ct.id=? OR EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=? AND cp.contact_id=ct.id))`).bind(projectId,sender,conversation.contact_id,conversation.id).all<{id:string}>()).results
 if(people.length+contacts.length!==1)return null
 if(people[0])return {id:people[0].id,role:people[0].role,projectId}
 return {id:contacts[0].id,contactId:contacts[0].id,role:'contact',projectId}
}

/** A reply from a preferred notification address (`provided_email`), through the
 * reply address issued to it for this conversation, is the reply of the primary
 * contact or participant holding that preference; the primary contact first. */
export async function preferredAddressActor(env:Env,projectId:string,conversation:any,sender:string):Promise<Actor|null>{
 const contacts=(await env.DB.prepare(`SELECT ct.id FROM contacts ct WHERE ct.project_id=? AND lower(json_extract(ct.metadata_json,'$.provided_email'))=? AND ${availableAs('ct')} AND (ct.id=? OR EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=? AND cp.contact_id=ct.id)) ORDER BY ct.id=? DESC LIMIT 2`).bind(projectId,sender,conversation.contact_id,conversation.id,conversation.contact_id).all<{id:string}>()).results
 const contact=contacts[0]?.id===conversation.contact_id||contacts.length===1?contacts[0]:null
 return contact?{id:contact.id,contactId:contact.id,role:'contact',projectId}:null
}

/** Bare mailbox policy: a fresh email continues the contact's most recently active
 * open non-form thread; closed history or a form submission starts a new one. */
export async function openEmailConversation(env:Env,projectId:string,contactId:string,mailboxId?:string|null){
 return env.DB.prepare("SELECT * FROM conversations WHERE project_id=? AND contact_id=? AND resolved_at IS NULL AND status_category<>'closed' AND (? IS NULL OR mailbox_id=?) AND NOT EXISTS(SELECT 1 FROM request_form_submissions form WHERE form.conversation_id=conversations.id AND form.project_id=conversations.project_id) ORDER BY updated_at DESC,id LIMIT 1").bind(projectId,contactId,mailboxId??null,mailboxId??null).first<any>()
}

/** CC recipients the sender may add. Workspace addresses, members and contacts that
 * cannot take part are skipped; none of them refuses the message. They join as
 * `cc_header` participants, which a Cc header alone never proves (participant-proof.ts). */
export async function ccContacts(env:Env,projectId:string,conversation:any,addresses:string[],skipped:ReadonlySet<string>){
 const contacts:string[]=[]
 for(const address of addresses){
  if(skipped.has(address))continue
  if(await env.DB.prepare('SELECT 1 FROM mailbox_addresses WHERE project_id=? AND lower(address)=? UNION ALL SELECT 1 FROM email_settings WHERE project_id=? AND (lower(inbound_address)=? OR lower(from_address)=?) LIMIT 1').bind(projectId,address,projectId,address,address).first())continue
  if(await env.DB.prepare('SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? AND lower(u.email)=?').bind(projectId,address).first())continue
  const contact=await emailContact(env,projectId,address)
  if(contact&&contact.id!==conversation.contact_id)contacts.push(contact.id)
 }
 return contacts
}
