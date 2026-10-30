import adoptionFixtures from './phase-fixtures.mjs'

/** New-tool catalogue fixtures are prepared separately from the retained n13
 * adoption rubric. Every phase gets fresh native case/draft ownership. */
export default async function(input){
 const {request,origin,cookie}=input
 const native=async(path,body,method=body===undefined?'GET':'POST')=>{
  const response=await request(origin+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
  if(!response.ok)throw new Error('Native operator tool fixture preparation refused')
  return response.json()
 }
 const link=await native('/api/rer/business-project'),project=link.linked.project_id,P=`/api/management/projects/${project}`
 const contact=(await native(P+'/contacts',{name:'Synthetic operator case'})).data
 const ticket=await native('/api/conversations',{projectId:project,contactId:contact.id})
 const reply=(await native(P+'/macros',{title:'Synthetic operator preparation',content:'Synthetic patient record 321-54-6789 response.'})).data
 await native(P+'/settings',{unavailable_message:'Synthetic patient record 321-54-6789 office notice.'},'PUT')
 const retained=await adoptionFixtures(input)
 return {...retained,values:{...retained.values,support:{project_id:project,conversation_id:ticket.id,revision:ticket.revision,last_message_id:ticket.last_message_id,reply_id:reply.id}}}
}
