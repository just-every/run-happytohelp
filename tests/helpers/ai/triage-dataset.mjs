import assert from 'node:assert/strict'
export const triageOwner={email:'alex@harbor-support.example.test',password:'synthetic-harbor-triage-owner-2026',name:'Harbor Commerce & Cloud',ownerName:'Alex Rivera'}
const messages={en:['I need a refund for my damaged order. I am disappointed.','My parcel has not arrived and I am frustrated.','My bill has a duplicate charge. Please fix this.','The dashboard crashes when I save an order.','How do I connect my store to the cloud workspace?'],es:['Necesito un reembolso por mi pedido dañado. Estoy decepcionada.','Mi envío no ha llegado y estoy frustrado.','Mi factura tiene un cargo duplicado. Necesito ayuda.','Hay un error al guardar mi pedido en el panel.','¿Cómo conecto mi tienda al espacio de trabajo?'],fr:['Je demande un remboursement pour ma commande endommagée.','Ma livraison est en retard et je suis déçu.','Ma facture contient un prélèvement en double.','Une erreur empêche de sauvegarder ma commande.','Comment connecter ma boutique à mon espace de travail?']}
export async function seedTriageDataset(origin,{count=12,installation,corrections=Math.min(count,8)}={}){
 const request=async(path,body,token,method=body===undefined?'GET':'POST',headers={})=>{const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...headers},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();assert.ok(response.ok,`${method} ${path}: ${response.status} ${JSON.stringify(value)}`);return value}
 const initial=installation??await request('/api/identity/bootstrap',{...triageOwner,allowedOrigin:origin}),login=await request('/api/identity/login',{email:triageOwner.email,password:triageOwner.password}),token=login.token,projectId=initial.projectId,base=`/api/dashboard/projects/${projectId}`
 const api=async(path,body,method)=>request(path,body,token,method)
 const getSettings=async()=>(await api(base+'/triage-settings')).data
 const profile=(await api(`/api/management/projects/${projectId}/ais`)).data[0]
 await api(`/api/management/projects/${projectId}/ais/${profile.id}`,{model:'gpt-5.6-luna'},'PUT')
 const me=(await api('/api/management/bootstrap')).currentAgent
 const group=(await api(base+'/ticket-groups',{name:'Triage review',members:[me.id]})).data
 await api(base+'/triage-settings',{...await getSettings(),enabled:true,default_group_id:group.id},'PUT')
 const project=await api(`/api/identity/projects/${projectId}`),tickets=[],start=Date.now()-29*86400000
 for(let n=0;n<count;n++){
  if(n%Math.ceil(count/30)===0)await api(base+'/workflow-clock',{now:start+Math.floor(n/Math.ceil(count/30))*86400000})
  const language=['en','es','fr'][n%3],content=messages[language][n%5]+` Order HC-${40200+n}.`,headers={Origin:origin,'CF-Connecting-IP':`10.41.${Math.floor(n/250)}.${n%250+1}`}
  const person=await request('/api/identity/widget/session',{widgetKey:project.widget_key,name:['Jamie Rivera','Carmen López','Camille Laurent','Taylor Chen','Morgan Lane'][n%5]+` ${n+1}`,email:`customer-${n}@harbor.example.test`},undefined,'POST',headers)
  const created=await request('/api/conversations',{projectId},person.token,'POST',headers)
  // Keep the team's responder choice independent from its configured triage model.
  await api(`${base}/conversations/${created.id}/actions`,{action:'assignAi',data:{ai_id:null}})
  await request(`/api/conversations/${created.id}/messages`,{localId:'opening-'+n,content,expectedRevision:0},person.token,'POST',headers)
  await api(`${base}/conversations/${created.id}/ticket`,{subject:['Refund for damaged order','Parcel tracking','Duplicate invoice charge','Dashboard save error','Connect my store'][n%5]+` · HC-${40200+n}`,priority:['normal','high','normal','urgent','low'][n%5]},'PATCH')
  tickets.push({id:created.id,person,language,content})
  if(n%50===49)console.log('Admitted tickets:',n+1)
 }
 for(const ticket of tickets){const deadline=Date.now()+60000;for(;;){const data=(await api(`${base}/conversations/${ticket.id}/triage`)).data;if(data.state==='complete'){assert.equal(data.values.language,ticket.language);break}if(data.state==='unavailable')throw Error(JSON.stringify(data));if(Date.now()>deadline)throw Error('Triage did not settle');await new Promise(r=>setTimeout(r,100))}}
 for(let n=0;n<corrections;n++)await api(`${base}/conversations/${tickets[n%tickets.length].id}/triage`,{field:'intent',value:['refund','shipping','billing','bug','how_to'][(n+Number(n%7===0))%5]},'PATCH')
 await api(base+'/workflow-clock',{now:Date.now()})
 return {projectId,base,api,token,tickets,group,owner:triageOwner,settings:getSettings,request}
}
