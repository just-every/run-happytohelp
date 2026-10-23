import {zip} from './zip.mjs'
import {vendorNotifications} from '../helpers/email/vendor-notifications.mjs'

export const publicBytes=Buffer.from([0,255,128,42,13,10,65]),privateBytes=Buffer.from('Internal parcel inspection, customer must not see this file.')
const member=(conversation,parent)=>`attachments/${encodeURIComponent(conversation)}/${encodeURIComponent(parent+':0')}`
export function attachmentFixtures(){
 return vendorNotifications().map(fixture=>{
  const rows=structuredClone(fixture.rows),vendor=fixture.vendor,time='2024-01-02T00:00:00Z'
  const metadata=(privateNote=false)=>{
   const name=privateNote?'inspection.txt':'parcel.bin',size=privateNote?privateBytes.length:publicBytes.length
   if(vendor==='helpscout')return {id:privateNote?940:939,filename:name,mimeType:'application/octet-stream',state:'valid',...(!privateNote?{size}:{})}
   if(vendor==='intercom')return {type:'upload',name,content_type:'application/octet-stream',filesize:size}
   return {id:privateNote?940:939,[vendor==='zendesk'?'file_name':'name']:name,content_type:'application/octet-stream',[vendor==='freshdesk'?'file_size':'size']:size}
  }
  let publicParent,privateParent
  if(vendor==='zendesk'){
   const ticket=rows[1].ticket;publicParent=String(ticket.comments[0].id);privateParent='941'
   rows.push({user:{id:93,role:'agent',name:'Historical teammate',email:'historical-teammate@example.test',created_at:time}})
   ticket.comments[0].attachments=[metadata()];ticket.comments.push({id:941,author_id:93,body:'Private inspection',public:false,created_at:time,attachments:[metadata(true)]})
  }else if(vendor==='freshdesk'){
   const ticket=rows[1].ticket;publicParent='description:'+ticket.id;privateParent='941'
   ticket.attachments=[metadata()];ticket.conversations=[{id:941,user_id:82,private:true,body_text:'Private inspection',created_at:time,attachments:[metadata(true)]}]
   rows.push({agent:{id:82,contact:{name:'Historical teammate',email:'historical-teammate@example.test'}}})
  }else if(vendor==='intercom'){
   const ticket=rows[1];publicParent='source:'+ticket.source.id;privateParent='n91'
   ticket.source.attachments=[metadata()];ticket.conversation_parts.conversation_parts=[{id:'n91',part_type:'note',body:'Private inspection',created_at:1704153600,author:{type:'admin',id:'a91',name:'Historical teammate'},attachments:[metadata(true)]}]
  }else{
   const threads=rows[2]._embedded.threads,publicPart=threads.find(thread=>thread.type!=='note'),privatePart=threads.find(thread=>thread.type==='note')
   publicParent=String(publicPart.id);privateParent=String(privatePart.id)
   publicPart._embedded={attachments:[metadata()]};privatePart._embedded={attachments:[metadata(true)]}
  }
  const members=[{name:member(fixture.sourceId,publicParent),body:publicBytes},{name:member(fixture.sourceId,privateParent),body:privateBytes}]
  const archive=(changed={})=>zip([{name:'history.jsonl',body:rows.map(JSON.stringify).join('\n')+'\n'.repeat(Number(changed.repack)||0)},...members.filter((_,index)=>!changed.missing||index===0)])
  return {...fixture,rows,members,archive,publicParent,privateParent}
 })
}
