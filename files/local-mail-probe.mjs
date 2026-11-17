import assert from 'node:assert/strict'
import {startApp} from '../tests/journeys/kit/app.mjs'
const origin='http://127.0.0.1:8787'
console.log('Starting isolated local mail probe')
const app=await startApp({origin,bindings:{H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@example.test',APP_ORIGIN:origin}})
try{
 console.log('Isolated application ready')
 const options=await app.call('/api/identity/sign-in-options',{status:200})
 assert.equal(options.data.mailMode,'local')
 const refused=await app.call('/api/identity/magic-link',{body:{email:'synthetic-d20-teammate@example.test'}})
 assert.equal(refused.status,503)
 assert.equal(refused.headers.get('set-cookie'),null)
 assert.equal(app.requests.length,0)
 console.log(JSON.stringify({probe:'local teammate email sign-in is unavailable',mailMode:options.data.mailMode,status:refused.status,newSession:false,outboundRequests:app.requests.length,pass:true}))
}finally{await app.close()}
