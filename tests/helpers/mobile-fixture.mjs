import {startApp} from '../journeys/kit/app.mjs'

export const root='/api/mobile/v1',allScopes=['read','reply','notes','assign','attachments','knowledge','push']
export async function fixture(){
 const app=await startApp(),w=await app.seedWorkspace('mobile'),other=await app.seedWorkspace('mobile-other')
 await app.presenceAwayOff(w.projectId);await app.presenceAwayOff(other.projectId)
 const ticket=async(workspace,suffix)=>{
  const contact=await app.ok(`/api/management/projects/${workspace.projectId}/contacts`,{token:workspace.tokens.owner,body:{name:'Private customer '+suffix,email:`customer-${suffix}@example.test`}})
  const id=contact.data?.id??contact.id
  return app.ok('/api/conversations',{token:workspace.tokens.owner,body:{projectId:workspace.projectId,contactId:id}})
 }
 const t=await ticket(w,'one'),foreign=await ticket(other,'two')
 const pair=async({token=w.tokens.operator,scopes=allScopes,platform='ios'}={})=>app.ok(root+'/devices',{token,body:{platform,scopes}})
 const call=(path,{token,...options}={})=>app.call(root+path,{token,...options})
 const read=async(device,id=t.id)=>(await call(`/tickets/${id}`,{token:device.token,status:200})).data
 return {app,w,other,t,foreign,pair,call,read}
}

