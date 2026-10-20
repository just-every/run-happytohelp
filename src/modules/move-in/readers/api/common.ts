import type {ApiAttachment,SourceAgent} from './types'
export const enc=(value:unknown)=>encodeURIComponent(String(value))
export function items(value:any,label:string):any[]{if(!Array.isArray(value))throw new Error(`${label}_response_invalid`);return value}
export function entity(value:any,label:string):any{if(!value||typeof value!=='object'||Array.isArray(value)||value.id==null)throw new Error(`${label}_response_invalid`);return value}
export function pageUrl(path:string,page:number):string{const url=new URL(path,'https://reader.invalid');url.searchParams.set('page',String(page));return path.startsWith('https://')?url.href:url.pathname+url.search}
export function agent(p:any,vendor:string):SourceAgent {
 const person=vendor==='freshdesk'?p.contact:p
 return {id:String(p.id),email:typeof person?.email==='string'?person.email:null,name:typeof person?.name==='string'?person.name:[person?.firstName,person?.lastName].filter(v=>typeof v==='string').join(' ')||'Unknown historical agent',deleted:p.deleted===true||p.deactivated===true||p.active===false}
}
export function attachments(ticket:any,partId:string,values:any,privatePart:boolean,vendor:string):ApiAttachment[]{
 // Intercom uploads have no id: retain the actual source locator as their identity.
 return items(values??[],`${vendor}_attachments`).map(a=>{
  const url=vendor==='helpscout'?`https://api.helpscout.net/v2/conversations/${enc(ticket)}/attachments/${enc(a.id)}/file`:a.content_url??a.attachment_url??a.url
  if((a.id==null&&vendor!=='intercom')||typeof url!=='string'||!url)throw new Error(`${vendor}_attachment_download_unavailable`)
  return {ticketId:String(ticket),partId,id:String(a.id??url),filename:a.file_name??a.filename??a.name??'',contentType:a.content_type??a.mimeType??a.contentType??'application/octet-stream',url,private:privatePart,size:typeof (a.size??a.filesize)==='number'?(a.size??a.filesize):null}
 })
}
export function zendeskNext(p:any):string|null{
 if(typeof p.end_of_stream==='boolean'){if(p.end_of_stream)return null;if(typeof p.after_url!=='string')throw new Error('zendesk_cursor_missing');return p.after_url}
 if(p.meta){if(typeof p.meta.has_more!=='boolean')throw new Error('zendesk_pagination_invalid');if(!p.meta.has_more)return null;if(typeof p.links?.next!=='string')throw new Error('zendesk_cursor_missing');return p.links.next}
 if(!Object.hasOwn(p,'next_page'))throw new Error('zendesk_pagination_missing')
 return p.next_page??null
}
