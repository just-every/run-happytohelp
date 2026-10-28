import {randomBytes} from 'node:crypto'
export default async function({request,origin,email,token}){
 const ownerResponse=await request(origin+'/api/identity/bootstrap',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({setupToken:token,email,password:randomBytes(32).toString('base64url'),allowedOrigin:'https://support-shop.example.test',ownerName:'Morgan Support'})})
 if(ownerResponse.status!==201)throw new Error('Native password and project setup refused')
 const cookie=ownerResponse.headers.getSetCookie(),owner=await ownerResponse.json()
 const native=async(path,body,method='POST')=>{
  const response=await request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+owner.token},body:JSON.stringify(body)})
  if(!response.ok)throw new Error('Native support fixture setup refused')
  return response.json()
 }
 const contact=(await native(`/api/management/projects/${owner.projectId}/contacts`,{name:'Avery Buyer',email:'avery@example.test'})).data
 const conversation=await native('/api/conversations',{projectId:owner.projectId,contactId:contact.id})
 await native(`/api/dashboard/projects/${owner.projectId}/conversations/${conversation.id}`,{subject:'Shipping request'},'PUT')
 await native(`/api/knowledge/${owner.projectId}/articles`,{title:'Shipping answer',content:'Orders ship in two business days.',status:'draft'})
 const protectedContact=(await native(`/api/management/projects/${owner.projectId}/contacts`,{name:'Casey Patient',email:'casey@example.test'})).data
 const protectedConversation=await native('/api/conversations',{projectId:owner.projectId,contactId:protectedContact.id})
 await native(`/api/dashboard/projects/${owner.projectId}/conversations/${protectedConversation.id}`,{subject:'Patient record 321-54-6789'},'PUT')
 await native(`/api/customer-context/${owner.projectId}/${protectedContact.id}/evidence`,{source:'customer_message',content:'Patient record 321-54-6789 is protected support evidence.'})
 await native(`/api/knowledge/${owner.projectId}/articles`,{title:'Patient record handling',content:'Social security number 321-54-6789 is synthetic protected material.',status:'draft'})
 const pairing=(await native(`/api/projects/${owner.projectId}/local-agents/pairings`,{})).data
 const paired=(await native('/api/local-agents/pair',{code:pairing.code,provider:'codex',name:'Support investigation device',capabilities:[]})).data
 await native(`/api/projects/${owner.projectId}/conversations/${conversation.id}/delegations`,{request_id:'support-shift-investigation',device_id:paired.device.id,mode:'investigate',instructions:'Read the selected support evidence. Do not repair or send a reply.'})
 return new Response(null,{status:303,headers:[['Location','/setup'],...cookie.map(value=>['Set-Cookie',value])]})
}
