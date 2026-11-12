import {createRuntime} from '../emitted-runtime.mjs'
import {client} from './http.mjs'
import {signingKey} from './fixture.mjs'
import {c2Flow} from './flow.mjs'
import {diagnosticRefusals} from './refusals.mjs'
import {deliveryCategories} from './delivery.mjs'
import {encryptionKey} from '../identity/two-factor.mjs'

export async function c2DiagnosticsJourney(){
 const runtime=await createRuntime({outboundFixture:new URL('./fixture.mjs',import.meta.url).pathname,vars:{H2H_LOCAL:'true',INTEGRATION_ENCRYPTION_KEY:encryptionKey(),EMAIL_PROVIDER:'sendgrid',EMAIL_API_KEY:'synthetic-happytohelp-c2',EMAIL_FROM:'support@desk-proof.example',INBOUND_EMAIL_TOKEN:'synthetic-happytohelp-c2-inbound',MAILGUN_WEBHOOK_SIGNING_KEY:signingKey}})
 let success=false
 try{
  const app=client(runtime.origin)
  await app.call('/api/identity/bootstrap',{body:{email:'owner@desk-proof.example',password:'synthetic-c2-owner-password',name:'Harbour pilot support',allowedOrigin:'https://harbour.example.test'},status:201})
  const login=(await app.call('/api/identity/login',{body:{email:'owner@desk-proof.example',password:'synthetic-c2-owner-password'},status:200})).data
  const state=await c2Flow(app,{token:login.token,projectId:login.actor.projectId})
  await deliveryCategories(app,state)
  await diagnosticRefusals(app,runtime,state)
  success=true
 }finally{await runtime.close(success)}
}
