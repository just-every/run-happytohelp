import {startApp} from '../../journeys/kit/app.mjs'
import {campaignsJourney} from './campaigns.mjs'
import {widgetEventsJourney,monitoringProvider} from './events.mjs'
import {socketJourney,revokeVisitor} from './socket.mjs'
import {lostResponseJourney} from './lost-response.mjs'

// One installation and visitor: choose proactive help, continue the linked ticket, exchange private/public
// activity, reconnect, recover an uncertain send, then revoke the session. Only provider/network edges are faked.
export async function widgetConversationJourney(){
 const app=await startApp({listen:true,captureQueue:true,origin:'https://app.example',cf:{country:'US'},bindings:{OPENAI_API_KEY:'synthetic-inert-test-key',RATE_LIMITS:JSON.stringify({widgetEventsPerContactMinute:500})},outbound:monitoringProvider})
 try{
  const workspace=await app.seedWorkspace('widget',{allowedOrigin:'https://widget.example'})
  const contact=await app.ok('/api/identity/widget/session',{body:{widgetKey:workspace.widgetKey},headers:{Origin:workspace.allowedOrigin}})
  const conversation=await app.ok('/api/conversations',{token:contact.token,body:{projectId:workspace.projectId}})
  const context={app,workspace,contact,conversation}
  context.conversation=await campaignsJourney(context)
  await widgetEventsJourney(context)
  await socketJourney(context)
  await lostResponseJourney(context)
  await revokeVisitor(context)
 }finally{await app.close()}
}
