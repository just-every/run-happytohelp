import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server.edge'
import Markdown from 'h2h-widget-markdown'
import gfm from 'h2h-widget-gfm'
import type {Env} from '../../platform/env'
import type {EmailAttachment} from './email'
import {emailFileLink} from './email-file-links'
// @ts-ignore Shared durable-message citation validator has no TypeScript declaration.
import {messageCitations} from '../conversations/citations.js'

type MailMessage={id:string;actor_id?:string;actor_role:string;content:unknown;citations_json?:string|null;citations?:unknown[];created_at?:number;erased_at?:number|null;source_author?:{name?:string|null;role?:string}|null}
type RenderInput={projectId:string;conversationId:string;messages:readonly MailMessage[]}
type Media={id:string;object_key:string;filename:string;content_type:string;size:number}
type Author={message_index:number;author_json:string|null;actor_found:string|null;name:string|null;email:string|null;metadata_json:string|null}
/** A file the email names and links instead of carrying. */
export type OmittedFile={filename:string;reason:'too_large'|'unavailable';url?:string}
const inlineImages=new Set(['image/png','image/jpeg','image/gif','image/webp','image/avif','image/bmp'])
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
// Encoded attachments stay under the 24 MiB whole-email check (validateEmailInput),
// leaving room for the text and HTML bodies.
const maxFileBytes=8*1024*1024,maxEncodedBytes=20*1024*1024
function base64(bytes:Uint8Array){let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(binary)}
function markdown(content:string){return renderToStaticMarkup(createElement(Markdown,{remarkPlugins:[gfm],children:content,urlTransform:(uri,key)=>((key==='src'?/^https?:\/\//i:/^(?:https?:\/\/|mailto:)/i).test(uri)?uri:'')}))}
async function authorName(env:Env,projectId:string,conversationId:string,message:MailMessage){
 if(message.source_author)return message.source_author.name||(message.source_author.role==='contact'?'Customer':'Imported author')
 if(message.actor_id?.startsWith('import:')){
  const imported=await env.DB.prepare('SELECT author_json FROM move_in_message_sources WHERE message_id=? AND project_id=?').bind(message.id,projectId).first<{author_json:string}>()
  if(imported)return JSON.parse(imported.author_json).name||'Imported author'
 }
 if(message.actor_id){
  const row=message.actor_role==='contact'
   ?await env.DB.prepare('SELECT name,email,metadata_json FROM contacts WHERE id=? AND project_id=?').bind(message.actor_id,projectId).first<{name:string|null;email:string|null;metadata_json:string}>()
   :message.actor_role==='ai'
    ?await env.DB.prepare('SELECT name FROM ai_profiles WHERE id=? AND project_id=?').bind(message.actor_id,projectId).first<{name:string}>()
    :await env.DB.prepare('SELECT u.name FROM users u JOIN messages m ON m.actor_id=u.id WHERE u.id=? AND m.id=? AND m.project_id=? AND m.conversation_id=?').bind(message.actor_id,message.id,projectId,conversationId).first<{name:string}>()
  if(row){const contact=row as {name?:string;email?:string;metadata_json?:string};const metadata=contact.metadata_json?JSON.parse(contact.metadata_json):{};return String(metadata.provided_name||contact.name||contact.email||(message.actor_role==='contact'?'Customer':'Support'))}
 }
 return message.actor_role==='contact'?'Customer':'Support'
}
function digestAuthorName(message:MailMessage,row?:Author){
 if(message.source_author)return message.source_author.name||(message.source_author.role==='contact'?'Customer':'Imported author')
 if(row?.author_json!=null)return JSON.parse(row.author_json).name||'Imported author'
 if(row?.actor_found!=null){const metadata=row.metadata_json?JSON.parse(row.metadata_json):{};return String(metadata.provided_name||row.name||row.email||(message.actor_role==='contact'?'Customer':'Support'))}
 return message.actor_role==='contact'?'Customer':'Support'
}
/** A digest has up to 100 messages. Resolve names and media in two statements,
 * keeping its admission cost independent of message and attachment counts. */
async function renderData(env:Env,input:{projectId:string;conversationId:string},messages:readonly MailMessage[]){
 const authors=new Map<number,Author>(),media=new Map<string,Media[]>()
 if(!messages.length)return {authors,media}
 const selected=messages.map((message,index)=>({index,id:message.id,actor_id:message.actor_id,actor_role:message.actor_role})).filter(row=>!messages[row.index].source_author&&row.actor_id)
 const [authorRows,mediaRows]=await Promise.all([
  selected.length?env.DB.prepare(`SELECT json_extract(selected.value,'$.index') message_index,imported.author_json,
   coalesce(contact.id,ai.id,operator.id) actor_found,
   CASE json_extract(selected.value,'$.actor_role') WHEN 'contact' THEN contact.name WHEN 'ai' THEN ai.name ELSE operator.name END name,
   contact.email,contact.metadata_json FROM json_each(?) selected
   LEFT JOIN move_in_message_sources imported ON imported.message_id=json_extract(selected.value,'$.id') AND imported.project_id=? AND substr(json_extract(selected.value,'$.actor_id'),1,7)='import:'
   LEFT JOIN contacts contact ON contact.id=json_extract(selected.value,'$.actor_id') AND contact.project_id=? AND json_extract(selected.value,'$.actor_role')='contact'
   LEFT JOIN ai_profiles ai ON ai.id=json_extract(selected.value,'$.actor_id') AND ai.project_id=? AND json_extract(selected.value,'$.actor_role')='ai'
   LEFT JOIN users operator ON operator.id=json_extract(selected.value,'$.actor_id') AND json_extract(selected.value,'$.actor_role') NOT IN ('contact','ai')
    AND EXISTS(SELECT 1 FROM messages m WHERE m.actor_id=operator.id AND m.id=json_extract(selected.value,'$.id') AND m.project_id=? AND m.conversation_id=?)`)
   .bind(JSON.stringify(selected),input.projectId,input.projectId,input.projectId,input.projectId,input.conversationId).all<Author>():Promise.resolve({results:[] as Author[]}),
  env.DB.prepare(`SELECT a.message_id,a.id,a.object_key,a.filename,a.content_type,a.size FROM media a
   JOIN messages m ON m.id=a.message_id AND m.project_id=a.project_id AND m.conversation_id=a.conversation_id
   WHERE m.id IN (SELECT value FROM json_each(?)) AND m.project_id=? AND m.conversation_id=? ORDER BY a.created_at,a.id`)
   .bind(JSON.stringify(messages.map(message=>message.id)),input.projectId,input.conversationId).all<Media&{message_id:string}>(),
 ])
 for(const row of authorRows.results)authors.set(row.message_index,row)
 for(const row of mediaRows.results){const files=media.get(row.message_id)||[];files.push(row);media.set(row.message_id,files)}
 return {authors,media}
}
const megabytes=(size:number)=>`${(size/1024/1024).toFixed(1)} MB`
/** Shared by notifications and explicit transcript sends. Media bytes are read only
 * through a message + conversation + workspace join, never through a supplied URL.
 * The email always renders: a file over the provider limit, or one that cannot be
 * read, is left out and named with a link to it in the conversation. */
export async function renderConversationEmail(env:Env,input:RenderInput){
 return renderConversation(env,input,async message=>{
  const [name,media]=await Promise.all([
   authorName(env,input.projectId,input.conversationId,message),
   env.DB.prepare('SELECT a.id,a.object_key,a.filename,a.content_type,a.size FROM media a JOIN messages m ON m.id=a.message_id AND m.project_id=a.project_id AND m.conversation_id=a.conversation_id WHERE m.id=? AND m.project_id=? AND m.conversation_id=? ORDER BY a.created_at,a.id').bind(message.id,input.projectId,input.conversationId).all<Media>(),
  ])
  return {name,media:media.results}
 })
}
/** Only the bounded unread digest uses bulk metadata reads. Ordinary mail keeps
 * its existing per-message reads and the same formatting and attachment loop. */
export async function renderConversationDigest(env:Env,input:RenderInput){
 const messages=input.messages.filter(message=>!message.erased_at&&message.actor_role!=='system'),data=await renderData(env,input,messages)
 return renderConversation(env,{...input,messages},async(message,index)=>({name:digestAuthorName(message,data.authors.get(index)),media:data.media.get(message.id)||[]}))
}
async function renderConversation(env:Env,input:RenderInput,loadMetadata:(message:MailMessage,index:number)=>Promise<{name:string;media:readonly Media[]}>){
 const attachments:EmailAttachment[]=[],omitted:OmittedFile[]=[],text:string[]=[],html:string[]=[]
 let encodedBytes=0
 for(const [index,message] of input.messages.entries()){
  if(message.erased_at||message.actor_role==='system')continue
  const {name,media}=await loadMetadata(message,index)
  const content=String(message.content??''),body:string[]=[],files:string[]=[]
  const disclosure=message.actor_role==='ai'?'This reply was written by an AI assistant.':''
  const citations:{title:string;url:string}[]=message.actor_role==='ai'?messageCitations(message):[]
  if(disclosure)body.push(`<p>${disclosure}</p>`)
  body.push(markdown(content))
  if(citations.length)body.push(`<ul>${citations.map(citation=>`<li><a href="${escape(citation.url)}">${escape(citation.title)}</a></li>`).join('')}</ul>`)
  for(const file of media){
   const filename=file.filename.replace(/[\x00-\x1f\x7f]/g,'').slice(0,200)||'attachment',encoded=4*Math.ceil(file.size/3)
   const fits=file.size<=maxFileBytes&&encodedBytes+encoded<=maxEncodedBytes
   const object=fits?await env.FILES.get(file.object_key):null
   if(!object||object.size!==file.size){
    const left:OmittedFile={filename,reason:fits?'unavailable':'too_large',url:await emailFileLink(env,input.projectId,input.conversationId,file.id)}
    const why=left.reason==='too_large'?`${megabytes(file.size)}, too large to attach`:'could not be attached'
    omitted.push(left)
    files.push(`Not attached: ${filename} (${why})${left.url?`. View it in the conversation: ${left.url}`:'. It is in the conversation.'}`)
    body.push(`<p>Not attached: ${left.url?`<a href="${escape(left.url)}">${escape(filename)}</a>`:escape(filename)} (${escape(why)})${left.url?'':'. It is in the conversation.'}</p>`)
    continue
   }
   encodedBytes+=encoded
   const bytes=new Uint8Array(await object.arrayBuffer())
   const contentType=file.content_type.split(';',1)[0].trim().toLowerCase()
   const type=/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType)?contentType:'application/octet-stream'
   const contentId=inlineImages.has(type)?`media-${attachments.length}@happytohelp`:undefined
   attachments.push({filename,content:base64(bytes),contentType:type,...(contentId?{contentId}:{})})
   files.push(`Attachment: ${filename}`)
   body.push(contentId?`<p><img src="cid:${contentId}" alt="${escape(filename)}" style="max-width:100%;height:auto" /></p>`:`<p>Attachment: ${escape(filename)}</p>`)
  }
  text.push([name,disclosure,content,...citations.map(citation=>`${citation.title}: ${citation.url}`),...files].filter(Boolean).join('\n'))
  html.push(`<section><p><strong>${escape(name)}</strong></p>${body.join('')}</section>`)
 }
 return {text:text.join('\n\n'),html:`<div>${html.join('<hr />')}</div>`,attachments,omitted}
}
