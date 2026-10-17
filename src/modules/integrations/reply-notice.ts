import type {Env} from '../../platform/env'

const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))

/** Without a reply address an emailed answer cannot be answered by email, so it says
 * so and links to the chat on the workspace's website, where the widget opens itself. */
export async function withChatReplyNotice<T extends {text:string;html:string}>(env:Env,projectId:string,content:T):Promise<T>{
 if(typeof env.H2H_CONNECTED_MESSAGE_MAILBOX==='string')return content
 const row=await env.DB.prepare('SELECT allowed_origin FROM projects WHERE id=?').bind(projectId).first<{allowed_origin:string|null}>()
 let link:string|null=null
 try{const url=new URL(String(row?.allowed_origin));if(['http:','https:'].includes(url.protocol))link=`${url.origin}/#launch-chat`}catch{}
 const lead='Replies to this email are not received.'
 return {...content,
  text:`${content.text}\n\n${lead} ${link?`To answer, continue in the chat: ${link}`:'To answer, continue in the chat on our website.'}`,
  html:`${content.html}<p>${lead} ${link?`To answer, <a href="${escape(link)}">continue in the chat</a>.`:'To answer, continue in the chat on our website.'}</p>`}
}
