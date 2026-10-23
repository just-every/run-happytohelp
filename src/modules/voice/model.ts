import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {ticketAuthority,named,object,invalid} from '../tickets/model'
import {scope} from '../management/common'
import {dashboardAccess} from '../management/dashboard'
import {decryptToken} from '../integrations/secrets'
export interface VoiceNumber {id:string;project_id:string;provider:'twilio'|'aircall';provider_id:string;account_id:string;phone:string;token_cipher:string|null;webhook_hash:string|null;settings_json:string;version:number;enabled:number}
export interface VoiceSettings {timezone:string;hours:{day:number;start:string;end:string}[];human_phone:string;aircall_user_id:string;group_id:string|null;ivr:{digit:string;label:string;phone:string}[];jurisdiction:string;recording_enabled:boolean}
export const usableContact=`EXISTS(SELECT 1 FROM contacts ct WHERE ct.id=c.contact_id AND ct.project_id=c.project_id AND coalesce(json_extract(ct.metadata_json,'$.is_erasing'),0)=0 AND coalesce(json_extract(ct.metadata_json,'$.is_erased'),0)=0 AND coalesce(json_extract(ct.metadata_json,'$.is_deleted'),0)=0 AND coalesce(json_extract(ct.metadata_json,'$.is_blocked'),0)=0) AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.contact_id)`
export const phone=(value:unknown)=>{const p=named(value,20);if(!/^\+[1-9]\d{7,14}$/.test(p))invalid('Use a full international telephone number. Emergency and short-code dialing are unavailable.');return p}
export const providerId=(value:unknown)=>{const id=named(value,100);if(!/^[A-Za-z0-9_-]+$/.test(id))invalid('Invalid provider ID');return id}
export function settingsInput(value:unknown):VoiceSettings {
 const b=object(value),timezone=named(b.timezone,100);try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format()}catch{invalid('Choose a time zone')}
 if(!Array.isArray(b.hours)||b.hours.length>21||!Array.isArray(b.ivr)||b.ivr.length>9||typeof b.recording_enabled!=='boolean'||!/^US-(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|AS|GU|MP|PR|VI)$/.test(b.jurisdiction))invalid('Choose US jurisdiction, hours, IVR and a recording policy')
 const hours=b.hours.map((v:any)=>{if(!Number.isInteger(v.day)||v.day<0||v.day>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.end)||v.start>=v.end)invalid('Use same-day opening hours, with start before end');return {day:v.day,start:v.start,end:v.end}})
 const ivr=b.ivr.map((v:any)=>{if(!/^[0-9]$/.test(v.digit))invalid('Use one IVR digit');return {digit:v.digit,label:named(v.label,60),phone:phone(v.phone)}})
 if(new Set(ivr.map((v:any)=>v.digit)).size!==ivr.length)invalid('IVR digits must be unique')
 return {timezone,hours,ivr,human_phone:phone(b.human_phone),aircall_user_id:b.aircall_user_id?providerId(b.aircall_user_id):'',group_id:b.group_id?named(b.group_id):null,jurisdiction:b.jurisdiction,recording_enabled:b.recording_enabled}
}
export function isOpen(s:VoiceSettings,at=Date.now()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:s.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(p=>[p.type,p.value]))
 const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday),clock=parts.hour+':'+parts.minute
 return s.hours.some(h=>h.day===day&&clock>=h.start&&clock<h.end)
}
export async function number(env:Env,id:string,projectId?:string){const n=await env.DB.prepare('SELECT * FROM voice_numbers WHERE id=? AND enabled=1'+(projectId?' AND project_id=?':'')).bind(id,...(projectId?[projectId]:[])).first<VoiceNumber>();if(!n?.token_cipher)throw new HTTPException(404);return n}
export async function voiceAccess(c:any,permission:'integrations.install'|'settings.manage'|'reports.view'='integrations.install'){
 const actor=await scope(c,permission!=='reports.view') as Actor,guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},permission)
 return {actor,guard}
}
export async function callAccess(c:any,write=false){
 const {actor,conversation}=await dashboardAccess(c),guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},write?'conversations.reply':'conversations.manage')
 if(!await c.env.DB.prepare(`SELECT id FROM conversations c WHERE c.id=? AND c.project_id=? AND ${usableContact} AND EXISTS(${guard.sql})`).bind(conversation.id,actor.projectId,...guard.params).first())throw new HTTPException(404)
 return {actor,conversation,guard}
}
export async function callId(n:VoiceNumber,remote:string){return 'voice-'+await hashToken(JSON.stringify([n.project_id,n.id,remote]))}
export async function credentials(env:Env,n:VoiceNumber){if(!n.token_cipher)throw new HTTPException(409);return await decryptToken(env,n.project_id,n.token_cipher)}
export const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
export const response=(body:string)=>'<?xml version="1.0" encoding="UTF-8"?><Response>'+body+'</Response>'
export const say=(text:string)=>'<Say>'+xml(text)+'</Say>'
export const limitations='This is customer support, not emergency dispatch. Hang up and dial 911 for an emergency. Number and location routing require provider qualification before launch.'
